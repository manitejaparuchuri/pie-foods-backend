import { Timestamp } from "firebase-admin/firestore";
import crypto from "crypto";
import getRazorpayClient from "../config/razorpay";
import { firestore } from "../config/firebase";
import { getFirestoreProductsCollectionName } from "../config/catalog";
import { notifyAdminOrderReceived } from "./order-notifications.service";

const ordersCollection = firestore.collection("orders");
const paymentsCollection = firestore.collection("payments");
const usersCollection = firestore.collection("users");
const productsCollection = firestore.collection(getFirestoreProductsCollectionName());

/**
 * Clear a user's cart subcollection in batches. Called AFTER the payment
 * transaction commits successfully — if this fails, the order is still PAID
 * (which is the safer side of the trade-off) and the next admin sweep can fix
 * the orphan. Never throws to the caller.
 */
export async function clearUserCart(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const snap = await usersCollection.doc(uid).collection("cart").get();
    if (snap.empty) return;
    const batch = firestore.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  } catch (error) {
    console.error("CLEAR USER CART ERROR (non-fatal):", uid, error);
  }
}

/* ================= CREATE RAZORPAY ORDER ================= */

export const createRazorpayOrderService = async (
  orderId: string,
  uid: string
) => {
  const razorpay = getRazorpayClient();

  const orderRef = ordersCollection.doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new Error("Order not found or unauthorized");
  }

  const order = orderSnap.data() as Record<string, unknown>;
  if (String(order.user_id || "") !== uid) {
    throw new Error("Order not found or unauthorized");
  }

  if (order.status !== "PENDING_PAYMENT") {
    throw new Error("Order not eligible for payment");
  }

  const amountInPaise = Math.round((Number(order.total_amount) || 0) * 100);
  if (!amountInPaise || amountInPaise <= 0) {
    throw new Error("Order not eligible for payment");
  }

  // If a Razorpay order was already created for this app order, reuse it so
  // we don't generate orphan Razorpay orders on every retry.
  const existingProviderOrderId = String(order.provider_order_id || "").trim();
  if (existingProviderOrderId) {
    try {
      const existing = await razorpay.orders.fetch(existingProviderOrderId);
      if (existing && Number(existing.amount) === amountInPaise) {
        return existing;
      }
    } catch (error) {
      // Fall through to create a fresh one if the old id is no longer valid.
      console.warn("Existing Razorpay order fetch failed, creating new:", error);
    }
  }

  const razorpayOrder = await razorpay.orders.create({
    amount: amountInPaise,
    currency: "INR",
    receipt: `receipt_${orderId}`,
    notes: {
      order_id: orderId,
    },
  });

  await orderRef.update({
    provider_order_id: razorpayOrder.id,
    updated_at: Timestamp.now(),
  });

  return razorpayOrder;
};

/* ================= VERIFY PAYMENT (FRONTEND CONFIRMATION FLOW) ================= */

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

interface OrderItemForStockDecrement {
  product_id: number;
  quantity: number;
}

function readOrderItems(order: Record<string, unknown>): OrderItemForStockDecrement[] {
  const raw = Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [];
  return raw
    .map((item) => ({
      product_id: Number(item?.product_id),
      quantity: Number(item?.quantity),
    }))
    .filter((line) => Number.isInteger(line.product_id) && line.product_id > 0 && line.quantity > 0);
}

export const verifyPaymentService = async (
  razorpay_order_id: string,
  razorpay_payment_id: string,
  razorpay_signature: string,
  orderId: string,
  uid: string
): Promise<boolean> => {
  const normalizedRazorpayOrderId = String(razorpay_order_id || "").trim();
  const normalizedRazorpayPaymentId = String(razorpay_payment_id || "").trim();
  const normalizedSignature = String(razorpay_signature || "").trim();

  if (
    !normalizedRazorpayOrderId ||
    !normalizedRazorpayPaymentId ||
    !normalizedSignature
  ) {
    throw new Error("Missing payment verification fields");
  }

  // Compute the expected signature using the canonical Razorpay scheme.
  // Trim the secret defensively in case the env var has stray whitespace.
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  if (!keySecret) {
    throw new Error("Razorpay secret not configured");
  }

  const body = `${normalizedRazorpayOrderId}|${normalizedRazorpayPaymentId}`;
  const expectedSignature = crypto.createHmac("sha256", keySecret).update(body).digest("hex");

  if (!timingSafeStringEqual(expectedSignature, normalizedSignature)) {
    // Deliberately no provider fallback here: HMAC verification is the contract.
    // If env or input drift caused a mismatch, the webhook will still capture the
    // payment and reconcile the order.
    throw new Error("Invalid payment signature");
  }

  const orderRef = ordersCollection.doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new Error("Order not found or unauthorized");
  }
  const order = orderSnap.data() as Record<string, unknown>;
  if (String(order.user_id || "") !== uid) {
    throw new Error("Order not found or unauthorized");
  }

  const savedProviderOrderId = String(order.provider_order_id || "").trim();
  if (savedProviderOrderId && savedProviderOrderId !== normalizedRazorpayOrderId) {
    throw new Error("Order mapping mismatch");
  }

  // Idempotency: if a payment with this provider_payment_id already exists,
  // make sure the order is PAID and exit. The transaction below uses payment
  // doc id == razorpay_payment_id, so a re-run reads a non-empty doc and skips.
  const paymentRef = paymentsCollection.doc(normalizedRazorpayPaymentId);
  const existingPaymentSnap = await paymentRef.get();
  if (existingPaymentSnap.exists) {
    // Already processed (verify or webhook beat us). Ensure order is PAID.
    if (String(order.status || "") !== "PAID") {
      await orderRef.update({
        status: "PAID",
        provider_order_id: normalizedRazorpayOrderId,
        updated_at: Timestamp.now(),
      });
    }
    await clearUserCart(uid);
    return true;
  }

  // Fetch the provider's authoritative payment record so we can validate the
  // amount against our stored order. Without this, an attacker who knows the
  // signing secret could replay a smaller-amount signature.
  const razorpay = getRazorpayClient();
  let providerPayment: any = null;
  try {
    providerPayment = await razorpay.payments.fetch(normalizedRazorpayPaymentId);
  } catch (error) {
    console.error("Razorpay payments.fetch failed:", error);
    throw new Error("Payment verification failed");
  }

  const providerAmountPaise = Number(providerPayment?.amount);
  if (!Number.isFinite(providerAmountPaise) || providerAmountPaise <= 0) {
    throw new Error("Invalid payment amount");
  }

  const expectedAmountPaise = Math.round((Number(order.total_amount) || 0) * 100);
  if (providerAmountPaise !== expectedAmountPaise) {
    console.error("Payment amount mismatch:", {
      orderId,
      providerAmountPaise,
      expectedAmountPaise,
    });
    throw new Error("Payment amount mismatch");
  }

  const providerStatus = String(providerPayment?.status || "").toLowerCase();
  if (providerStatus !== "captured" && providerStatus !== "authorized") {
    throw new Error("Payment not captured");
  }

  const currency = String(providerPayment?.currency || "INR").toUpperCase();
  const idempotencyKey = `rzp_verify_${normalizedRazorpayPaymentId}`.slice(0, 64);

  const orderItems = readOrderItems(order);

  // Atomic: mark order PAID, decrement stock, write payment record.
  // Firestore transactions retry on contention, so all reads must precede writes.
  await firestore.runTransaction(async (tx) => {
    const freshOrderSnap = await tx.get(orderRef);
    if (!freshOrderSnap.exists) {
      throw new Error("Order disappeared mid-transaction");
    }
    const fresh = freshOrderSnap.data() as Record<string, unknown>;
    if (fresh.status !== "PENDING_PAYMENT") {
      // Another verify/webhook beat us. Idempotent no-op.
      return;
    }

    // Lock all product docs we plan to decrement (reads must happen before writes).
    const productRefs = orderItems.map((line) => productsCollection.doc(`product-${line.product_id}`));
    const productSnaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));

    // Validate stock for every line before writing anything.
    productSnaps.forEach((snap, idx) => {
      const line = orderItems[idx];
      if (!snap.exists) {
        throw new Error(`Product no longer available: ${line.product_id}`);
      }
      const stock = Number((snap.data() as Record<string, unknown>).stock_quantity ?? 0);
      if (stock < line.quantity) {
        throw new Error(`Insufficient stock for product ${line.product_id}`);
      }
    });

    // Now writes — order, payment, then each stock decrement.
    tx.update(orderRef, {
      status: "PAID",
      provider_order_id: normalizedRazorpayOrderId,
      updated_at: Timestamp.now(),
    });

    tx.set(paymentRef, {
      payment_id: normalizedRazorpayPaymentId,
      order_id: orderId,
      user_id: uid,
      provider: "RAZORPAY",
      provider_order_id: normalizedRazorpayOrderId,
      provider_payment_id: normalizedRazorpayPaymentId,
      provider_signature: normalizedSignature,
      amount: providerAmountPaise,
      currency,
      status: "SUCCESS",
      idempotency_key: idempotencyKey,
      payment_date: Timestamp.now(),
      updated_at: Timestamp.now(),
    });

    productSnaps.forEach((snap, idx) => {
      const line = orderItems[idx];
      const stock = Number((snap.data() as Record<string, unknown>).stock_quantity ?? 0);
      tx.update(productRefs[idx], {
        stock_quantity: stock - line.quantity,
        updated_at: Timestamp.now(),
      });
    });
  });

  // Cart clearing happens AFTER the transaction commits. If this fails it's
  // logged but doesn't roll back the payment — better a stale cart than
  // a paid order that lost its payment record.
  await clearUserCart(uid);

  // Fire-and-forget admin notification. Never blocks or fails the verify path.
  notifyAdminOrderReceived(orderId).catch((err) =>
    console.error("admin notify (verify) failed:", err)
  );

  return true;
};
