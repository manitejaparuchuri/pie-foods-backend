import { Request, Response } from "express";
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { AuthRequest } from "../middlewares/auth";
import {
  createRazorpayOrderService,
  verifyPaymentService,
} from "../services/payment.service";

const ordersCollection = firestore.collection("orders");
const paymentsCollection = firestore.collection("payments");
const webhookEventsCollection = firestore.collection("payment_webhook_events");
const usersCollection = firestore.collection("users");

async function clearUserCart(uid: string): Promise<void> {
  if (!uid) return;
  const snap = await usersCollection.doc(uid).collection("cart").get();
  if (snap.empty) return;
  const batch = firestore.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

export const createPaymentOrder = async (req: AuthRequest, res: Response) => {
  try {
    const orderId = String(req.body?.order_id || req.body?.orderId || "").trim();
    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!orderId) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const order = await createRazorpayOrderService(orderId, uid);

    return res.json({
      key_id: process.env.RAZORPAY_KEY_ID,
      razorpay_order_id: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (error: any) {
    console.error("CREATE PAYMENT ORDER ERROR:", error);
    const safeClientMessages = new Set([
      "Order not found or unauthorized",
      "Order not eligible for payment",
    ]);
    const message = String(error?.message || "");
    if (safeClientMessages.has(message)) {
      return res.status(400).json({ message });
    }
    return res.status(500).json({ message: "Unable to create payment order" });
  }
};

export const verifyPayment = async (req: AuthRequest, res: Response) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      order_id: rawOrderId,
      orderId: rawOrderIdAlt,
    } = req.body;

    const uid = req.user?.uid;
    const orderId = String(rawOrderId || rawOrderIdAlt || "").trim();

    if (!uid) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!orderId) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing payment verification fields" });
    }

    await verifyPaymentService(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId,
      uid
    );

    return res.json({ message: "Payment verified successfully" });
  } catch (error: any) {
    console.error("VERIFY PAYMENT ERROR:", error);
    const safeClientMessages = new Set([
      "Missing payment verification fields",
      "Invalid payment signature",
      "Order not found or unauthorized",
      "Order mapping mismatch",
      "Invalid payment amount",
    ]);
    const message = String(error?.message || "");
    if (safeClientMessages.has(message)) {
      return res.status(400).json({ message });
    }
    return res.status(500).json({ message: "Payment verification failed" });
  }
};

export const razorpayWebhook = async (req: Request, res: Response) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET as string;
    const signature = String(req.headers["x-razorpay-signature"] || "");

    if (!secret) {
      console.error("RAZORPAY_WEBHOOK_SECRET is not configured");
      return res.status(500).json({ message: "Webhook secret not configured" });
    }

    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ message: "Invalid webhook payload" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const receivedSig = Buffer.from(signature);
    const expectedSig = Buffer.from(expectedSignature);
    const isSignatureValid =
      receivedSig.length === expectedSig.length &&
      crypto.timingSafeEqual(receivedSig, expectedSig);

    if (!isSignatureValid) {
      console.log("Invalid webhook signature");
      return res.status(400).json({ message: "Invalid signature" });
    }

    const body = JSON.parse(rawBody.toString());
    const event = body.event;
    const paymentEntity = body?.payload?.payment?.entity;
    const eventIdExt = String(paymentEntity?.id || `unknown_${Date.now()}`);

    // Idempotently log the webhook event (doc id = razorpay payment id when available).
    await webhookEventsCollection.doc(eventIdExt).set(
      {
        provider: "RAZORPAY",
        event_id_ext: eventIdExt,
        event_type: event || null,
        payload: body,
        received_at: Timestamp.now(),
      },
      { merge: true }
    );

    if (event === "payment.captured" && paymentEntity) {
      const paymentId = String(paymentEntity.id || "");
      const razorpayOrderId = String(paymentEntity.order_id || "");
      const amountInPaise = Number(paymentEntity.amount || 0);
      const currency = String(paymentEntity.currency || "INR").toUpperCase();
      const idempotencyKey = `rzp_webhook_${paymentId}`.slice(0, 64);

      let resolvedOrderId = "";
      let resolvedUserId = "";

      const orderByProviderSnap = await ordersCollection
        .where("provider_order_id", "==", razorpayOrderId)
        .limit(1)
        .get();

      if (!orderByProviderSnap.empty) {
        const doc = orderByProviderSnap.docs[0];
        resolvedOrderId = doc.id;
        resolvedUserId = String((doc.data() as Record<string, unknown>).user_id || "");
      } else {
        const fallbackOrderId = String(paymentEntity?.notes?.order_id || "").trim();
        if (fallbackOrderId) {
          const fallbackSnap = await ordersCollection.doc(fallbackOrderId).get();
          if (fallbackSnap.exists) {
            resolvedOrderId = fallbackSnap.id;
            resolvedUserId = String(
              (fallbackSnap.data() as Record<string, unknown>).user_id || ""
            );
          }
        }
      }

      if (!resolvedOrderId) {
        console.log("No matching order found:", razorpayOrderId);
        return res.status(200).json({ status: "ignored" });
      }

      const paymentRef = paymentsCollection.doc(paymentId);
      const existing = await paymentRef.get();
      if (existing.exists) {
        console.log("Duplicate webhook ignored:", paymentId);
        return res.status(200).json({ status: "duplicate" });
      }

      const orderRef = ordersCollection.doc(resolvedOrderId);
      await firestore.runTransaction(async (tx) => {
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) return;
        const order = orderSnap.data() as Record<string, unknown>;
        if (order.status === "PENDING_PAYMENT") {
          tx.update(orderRef, {
            status: "PAID",
            provider_order_id: razorpayOrderId,
            updated_at: Timestamp.now(),
          });
        }
        tx.set(paymentRef, {
          payment_id: paymentId,
          order_id: resolvedOrderId,
          user_id: resolvedUserId,
          provider: "RAZORPAY",
          provider_order_id: razorpayOrderId,
          provider_payment_id: paymentId,
          provider_signature: signature,
          amount: amountInPaise,
          currency,
          status: "SUCCESS",
          idempotency_key: idempotencyKey,
          payment_date: Timestamp.now(),
          updated_at: Timestamp.now(),
        });
      });

      if (resolvedUserId) {
        await clearUserCart(resolvedUserId);
      }

      console.log("Payment saved via webhook:", paymentId);
    }

    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
};
