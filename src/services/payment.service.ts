import { Timestamp } from "firebase-admin/firestore";
import crypto from "crypto";
import getRazorpayClient from "../config/razorpay";
import { firestore } from "../config/firebase";

const ordersCollection = firestore.collection("orders");
const paymentsCollection = firestore.collection("payments");
const usersCollection = firestore.collection("users");

async function clearUserCart(uid: string): Promise<void> {
  const snap = await usersCollection.doc(uid).collection("cart").get();
  if (snap.empty) return;
  const batch = firestore.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
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

/* ================= VERIFY PAYMENT (FRONTEND FLOW) ================= */

export const verifyPaymentService = async (
  razorpay_order_id: string,
  razorpay_payment_id: string,
  razorpay_signature: string,
  orderId: string,
  uid: string
): Promise<boolean> => {
  const razorpay = getRazorpayClient();

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

  const body = `${normalizedRazorpayOrderId}|${normalizedRazorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET as string)
    .update(body)
    .digest("hex");

  let providerPayment: any = null;
  let signatureValid = expectedSignature === normalizedSignature;

  if (!signatureValid) {
    try {
      providerPayment = await razorpay.payments.fetch(normalizedRazorpayPaymentId);
      signatureValid =
        providerPayment?.id === normalizedRazorpayPaymentId &&
        providerPayment?.order_id === normalizedRazorpayOrderId &&
        (providerPayment?.status === "captured" ||
          providerPayment?.status === "authorized");
    } catch {
      signatureValid = false;
    }
  }

  if (!signatureValid) {
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

  // Idempotency: if a payment with this provider_payment_id already exists, just ensure order is PAID.
  const existingPaymentSnap = await paymentsCollection
    .where("provider_payment_id", "==", normalizedRazorpayPaymentId)
    .limit(1)
    .get();

  if (!existingPaymentSnap.empty) {
    await orderRef.update({
      status: "PAID",
      provider_order_id: normalizedRazorpayOrderId,
      updated_at: Timestamp.now(),
    });
    await clearUserCart(uid);
    return true;
  }

  if (!providerPayment) {
    try {
      providerPayment = await razorpay.payments.fetch(normalizedRazorpayPaymentId);
    } catch {
      providerPayment = null;
    }
  }

  const amountInPaise = Number.isFinite(Number(providerPayment?.amount))
    ? Number(providerPayment.amount)
    : Math.round((Number(order.total_amount) || 0) * 100);
  const currency = String(providerPayment?.currency || "INR").toUpperCase();
  const idempotencyKey = `rzp_verify_${normalizedRazorpayPaymentId}`.slice(0, 64);

  if (!Number.isFinite(amountInPaise) || amountInPaise <= 0) {
    throw new Error("Invalid payment amount");
  }

  const paymentRef = paymentsCollection.doc(normalizedRazorpayPaymentId);
  await firestore.runTransaction(async (tx) => {
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
      amount: amountInPaise,
      currency,
      status: "SUCCESS",
      idempotency_key: idempotencyKey,
      payment_date: Timestamp.now(),
      updated_at: Timestamp.now(),
    });
  });

  await clearUserCart(uid);
  return true;
};
