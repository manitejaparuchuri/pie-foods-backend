import { Request, Response } from "express";
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import getRazorpayClient from "../config/razorpay";
import { getFirestoreProductsCollectionName } from "../config/catalog";
import { loadGuestOrderForAccess } from "../services/guest-order.service";
import {
  notifyAdminOrderReceived,
  notifyCustomerOrderConfirmed,
} from "../services/order-notifications.service";

const ordersCollection = firestore.collection("orders");
const paymentsCollection = firestore.collection("payments");
const productsCollection = firestore.collection(
  getFirestoreProductsCollectionName()
);

interface OrderItemForStockDecrement {
  product_id: number;
  quantity: number;
}

function readOrderItems(
  order: Record<string, unknown>
): OrderItemForStockDecrement[] {
  const raw = Array.isArray(order.items)
    ? (order.items as Array<Record<string, unknown>>)
    : [];
  return raw
    .map((item) => ({
      product_id: Number(item?.product_id),
      quantity: Number(item?.quantity),
    }))
    .filter(
      (line) =>
        Number.isInteger(line.product_id) &&
        line.product_id > 0 &&
        line.quantity > 0
    );
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ============================ POST /api/payment/guest/create-order ============================ */

export const createGuestPaymentOrder = async (req: Request, res: Response) => {
  try {
    const orderId = String(req.body?.orderId || req.body?.order_id || "").trim();
    const token = String(
      req.body?.guestAccessToken ||
        req.body?.guest_access_token ||
        req.headers["x-guest-token"] ||
        ""
    ).trim();

    if (!orderId || !token) {
      return res
        .status(400)
        .json({ message: "Order id and access token required" });
    }

    const { orderRef, data: order } = await loadGuestOrderForAccess(
      orderId,
      token
    );

    if (order.status !== "PENDING_PAYMENT") {
      return res.status(400).json({ message: "Order not eligible for payment" });
    }

    const amountInPaise = Math.round((Number(order.total_amount) || 0) * 100);
    if (!amountInPaise || amountInPaise <= 0) {
      return res.status(400).json({ message: "Invalid order amount" });
    }

    const razorpay = getRazorpayClient();

    // Reuse the existing Razorpay order when one was already created (idempotent retry)
    const existingProviderOrderId = String(order.provider_order_id || "").trim();
    if (existingProviderOrderId) {
      try {
        const existing = await razorpay.orders.fetch(existingProviderOrderId);
        if (existing && Number(existing.amount) === amountInPaise) {
          return res.json({
            key_id: String(process.env.RAZORPAY_KEY_ID || "").trim(),
            razorpay_order_id: existing.id,
            amount: existing.amount,
            currency: existing.currency,
            order_id: orderId,
          });
        }
      } catch (err) {
        console.warn("Existing Razorpay order fetch failed, creating new:", err);
      }
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `guest_${orderId}`.slice(0, 40),
      notes: {
        order_id: orderId,
        is_guest: "true",
      },
    });

    await orderRef.update({
      provider_order_id: razorpayOrder.id,
      updated_at: Timestamp.now(),
    });

    return res.json({
      key_id: String(process.env.RAZORPAY_KEY_ID || "").trim(),
      razorpay_order_id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      order_id: orderId,
    });
  } catch (error: any) {
    const message = String(error?.message || "");
    if (message === "Order not found" || message === "Order id and access token are required") {
      return res.status(404).json({ message: "Order not found" });
    }
    if (message === "Order not eligible for payment" || message === "Invalid order amount") {
      return res.status(400).json({ message });
    }
    console.error("CREATE GUEST PAYMENT ORDER ERROR:", error);
    return res
      .status(500)
      .json({ message: "Unable to create payment order" });
  }
};

/* ============================ POST /api/payment/guest/verify ============================ */

export const verifyGuestPayment = async (req: Request, res: Response) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId: rawOrderId,
      order_id: rawOrderIdAlt,
      guestAccessToken,
      guest_access_token,
    } = req.body || {};

    const orderId = String(rawOrderId || rawOrderIdAlt || "").trim();
    const token = String(
      guestAccessToken || guest_access_token || req.headers["x-guest-token"] || ""
    ).trim();

    if (!orderId || !token) {
      return res
        .status(400)
        .json({ message: "Order id and access token required" });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res
        .status(400)
        .json({ message: "Missing payment verification fields" });
    }

    const normalizedRazorpayOrderId = String(razorpay_order_id).trim();
    const normalizedRazorpayPaymentId = String(razorpay_payment_id).trim();
    const normalizedSignature = String(razorpay_signature).trim();

    // Verify HMAC signature against Razorpay's canonical scheme
    const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
    if (!keySecret) {
      throw new Error("Razorpay secret not configured");
    }

    const body = `${normalizedRazorpayOrderId}|${normalizedRazorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(body)
      .digest("hex");

    if (!timingSafeStringEqual(expectedSignature, normalizedSignature)) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    // Token-authenticated order lookup (constant-time)
    const { orderRef, data: order } = await loadGuestOrderForAccess(
      orderId,
      token
    );

    const savedProviderOrderId = String(order.provider_order_id || "").trim();
    if (
      savedProviderOrderId &&
      savedProviderOrderId !== normalizedRazorpayOrderId
    ) {
      return res.status(400).json({ message: "Order mapping mismatch" });
    }

    // Idempotency: payment doc id == razorpay payment id
    const paymentRef = paymentsCollection.doc(normalizedRazorpayPaymentId);
    const existingPaymentSnap = await paymentRef.get();
    if (existingPaymentSnap.exists) {
      // Already processed by an earlier verify or by the webhook
      if (String(order.status || "") !== "PAID") {
        await orderRef.update({
          status: "PAID",
          provider_order_id: normalizedRazorpayOrderId,
          updated_at: Timestamp.now(),
        });
      }
      return res.json({
        message: "Payment already verified",
        order_id: orderId,
      });
    }

    // Pull authoritative payment from Razorpay and validate the amount
    const razorpay = getRazorpayClient();
    let providerPayment: any = null;
    try {
      providerPayment = await razorpay.payments.fetch(
        normalizedRazorpayPaymentId
      );
    } catch (err) {
      console.error("Razorpay payments.fetch failed:", err);
      return res
        .status(500)
        .json({ message: "Payment verification failed" });
    }

    const providerAmountPaise = Number(providerPayment?.amount);
    if (!Number.isFinite(providerAmountPaise) || providerAmountPaise <= 0) {
      return res.status(400).json({ message: "Invalid payment amount" });
    }

    const expectedAmountPaise = Math.round((Number(order.total_amount) || 0) * 100);
    if (providerAmountPaise !== expectedAmountPaise) {
      console.error("Guest payment amount mismatch:", {
        orderId,
        providerAmountPaise,
        expectedAmountPaise,
      });
      return res.status(400).json({ message: "Payment amount mismatch" });
    }

    const providerStatus = String(providerPayment?.status || "").toLowerCase();
    if (providerStatus !== "captured" && providerStatus !== "authorized") {
      return res.status(400).json({ message: "Payment not captured" });
    }

    const currency = String(providerPayment?.currency || "INR").toUpperCase();
    const idempotencyKey = `rzp_guest_${normalizedRazorpayPaymentId}`.slice(0, 64);

    const orderItems = readOrderItems(order);

    // Atomic: mark PAID + decrement stock + write payment record
    await firestore.runTransaction(async (tx) => {
      const freshOrderSnap = await tx.get(orderRef);
      if (!freshOrderSnap.exists) {
        throw new Error("Order disappeared mid-transaction");
      }
      const fresh = freshOrderSnap.data() as Record<string, unknown>;
      if (fresh.status !== "PENDING_PAYMENT") {
        return; // Already processed
      }

      const productRefs = orderItems.map((line) =>
        productsCollection.doc(`product-${line.product_id}`)
      );
      const productSnaps = await Promise.all(
        productRefs.map((ref) => tx.get(ref))
      );

      productSnaps.forEach((snap, idx) => {
        const line = orderItems[idx];
        if (!snap.exists) {
          throw new Error(`Product no longer available: ${line.product_id}`);
        }
        const stock = Number(
          (snap.data() as Record<string, unknown>).stock_quantity ?? 0
        );
        if (stock < line.quantity) {
          throw new Error(`Insufficient stock for product ${line.product_id}`);
        }
      });

      tx.update(orderRef, {
        status: "PAID",
        provider_order_id: normalizedRazorpayOrderId,
        updated_at: Timestamp.now(),
      });

      tx.set(paymentRef, {
        payment_id: normalizedRazorpayPaymentId,
        order_id: orderId,
        user_id: null,
        is_guest: true,
        customer_email: String(order.customer_email || ""),
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
        const stock = Number(
          (snap.data() as Record<string, unknown>).stock_quantity ?? 0
        );
        tx.update(productRefs[idx], {
          stock_quantity: stock - line.quantity,
          updated_at: Timestamp.now(),
        });
      });
    });

    // Fire-and-forget notifications (never block the response)
    notifyAdminOrderReceived(orderId).catch((err) =>
      console.error("admin notify (guest verify) failed:", err)
    );
    notifyCustomerOrderConfirmed(orderId).catch((err) =>
      console.error("customer confirm notify (guest verify) failed:", err)
    );

    return res.json({
      message: "Payment verified successfully",
      order_id: orderId,
    });
  } catch (error: any) {
    const message = String(error?.message || "");
    if (
      message === "Order not found" ||
      message === "Order id and access token are required"
    ) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (message.startsWith("Insufficient stock") || message.startsWith("Product no longer available")) {
      return res.status(409).json({ message });
    }
    console.error("VERIFY GUEST PAYMENT ERROR:", error);
    return res.status(500).json({ message: "Payment verification failed" });
  }
};
