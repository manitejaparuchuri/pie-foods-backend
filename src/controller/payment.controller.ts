import { Request, Response } from "express";
import crypto from "crypto";
import pool from "../config/db";
import { AuthRequest } from "../middlewares/auth";
import {
  createRazorpayOrderService,
  verifyPaymentService,
} from "../services/payment.service";

export const createPaymentOrder = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const order_id = Number(req.body?.order_id);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!Number.isInteger(order_id) || order_id <= 0) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const order = await createRazorpayOrderService(order_id, userId);

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

export const verifyPayment = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      order_id: rawOrderId,
    } = req.body;

    const userId = req.user?.id;
    const order_id = Number(rawOrderId);

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!Number.isFinite(order_id) || order_id <= 0) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing payment verification fields" });
    }

    await verifyPaymentService(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      order_id,
      userId
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

    await pool.query(
      `INSERT INTO payment_webhook_events
      (provider, event_id, payload, received_at)
      VALUES ('RAZORPAY', ?, ?, NOW())`,
      [paymentEntity?.id || "unknown", JSON.stringify(body)]
    );

    if (event === "payment.captured" && paymentEntity) {
      const paymentId = String(paymentEntity.id || "");
      const razorpayOrderId = String(paymentEntity.order_id || "");
      const amountInPaise = Number(paymentEntity.amount || 0);
      const currency = String(paymentEntity.currency || "INR").toUpperCase();
      const idempotencyKey = `rzp_webhook_${paymentId}`.slice(0, 64);

      const [orderRows]: any = await pool.query(
        "SELECT order_id FROM orders WHERE provider_order_id=? LIMIT 1",
        [razorpayOrderId]
      );

      const orderId = Number(orderRows?.[0]?.order_id || 0);
      const fallbackOrderId = Number(paymentEntity?.notes?.order_id || 0);
      const resolvedOrderId =
        orderId || (Number.isInteger(fallbackOrderId) && fallbackOrderId > 0 ? fallbackOrderId : 0);

      if (!resolvedOrderId) {
        console.log("No matching order found:", razorpayOrderId);
        return res.status(200).json({ status: "ignored" });
      }

      const [existing]: any = await pool.query(
        "SELECT payment_id FROM payments WHERE provider_payment_id=?",
        [paymentId]
      );

      if (existing.length > 0) {
        console.log("Duplicate webhook ignored:", paymentId);
        return res.status(200).json({ status: "duplicate" });
      }

      await pool.query(
        "UPDATE orders SET status='PAID' WHERE order_id=?",
        [resolvedOrderId]
      );

      await pool.query(
        `INSERT INTO payments
        (order_id, provider, provider_order_id, provider_payment_id, provider_signature, amount, currency, status, idempotency_key, payment_date, updated_at)
        VALUES (?, 'RAZORPAY', ?, ?, ?, ?, ?, 'SUCCESS', ?, NOW(), NOW())`,
        [resolvedOrderId, razorpayOrderId, paymentId, signature, amountInPaise, currency, idempotencyKey]
      );

      console.log("Payment saved via webhook:", paymentId);
    }

    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
};
