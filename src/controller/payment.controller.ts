import { Request, Response } from "express";
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { getFirestoreProductsCollectionName } from "../config/catalog";
import { AuthRequest } from "../middlewares/auth";
import {
  clearUserCart,
  createRazorpayOrderService,
  verifyPaymentService,
} from "../services/payment.service";
import {
  notifyAdminOrderReceived,
  notifyCustomerOrderConfirmed,
} from "../services/order-notifications.service";

const ordersCollection = firestore.collection("orders");
const paymentsCollection = firestore.collection("payments");
const webhookEventsCollection = firestore.collection("payment_webhook_events");
const productsCollection = firestore.collection(getFirestoreProductsCollectionName());

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

    // key_id is a PUBLIC identifier — the frontend needs it to open Razorpay
    // checkout. The secret never leaves the server.
    return res.json({
      key_id: String(process.env.RAZORPAY_KEY_ID || "").trim(),
      razorpay_order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      order_id: orderId,
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

    return res.json({ message: "Payment verified successfully", order_id: orderId });
  } catch (error: any) {
    console.error("VERIFY PAYMENT ERROR:", error);
    const safeClientMessages = new Set([
      "Missing payment verification fields",
      "Invalid payment signature",
      "Order not found or unauthorized",
      "Order mapping mismatch",
      "Invalid payment amount",
      "Payment amount mismatch",
      "Payment not captured",
    ]);
    const message = String(error?.message || "");
    if (safeClientMessages.has(message)) {
      return res.status(400).json({ message });
    }
    // Stock-related errors are 409 (conflict) so the client knows the order
    // can't be fulfilled even though Razorpay captured the money.
    if (message.startsWith("Insufficient stock") || message.startsWith("Product no longer available")) {
      return res.status(409).json({ message });
    }
    return res.status(500).json({ message: "Payment verification failed" });
  }
};

export const razorpayWebhook = async (req: Request, res: Response) => {
  try {
    const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
    const signature = String(req.headers["x-razorpay-signature"] || "").trim();

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

    // Always log the webhook event (idempotent by payment id).
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

    // Only payment.captured drives our PAID transition.
    if (event !== "payment.captured" || !paymentEntity) {
      return res.status(200).json({ status: "ignored", event });
    }

    const paymentId = String(paymentEntity.id || "");
    const razorpayOrderId = String(paymentEntity.order_id || "");
    const amountInPaise = Number(paymentEntity.amount || 0);
    const currency = String(paymentEntity.currency || "INR").toUpperCase();
    const idempotencyKey = `rzp_webhook_${paymentId}`.slice(0, 64);

    if (!paymentId || !razorpayOrderId || !Number.isFinite(amountInPaise) || amountInPaise <= 0) {
      console.error("Webhook missing critical fields:", { paymentId, razorpayOrderId, amountInPaise });
      // Return 200 so Razorpay does not retry indefinitely; we have the event
      // logged for manual reconciliation.
      return res.status(200).json({ status: "ignored", reason: "missing_fields" });
    }

    // Resolve our internal order. Prefer the provider_order_id we stamped when
    // creating the Razorpay order; fall back to notes.order_id which we set on
    // razorpay.orders.create.
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
      console.error("Webhook: no matching order:", { razorpayOrderId, paymentId });
      // 200 keeps Razorpay from hammering us — the event is logged for triage.
      return res.status(200).json({ status: "ignored", reason: "no_order" });
    }

    // Idempotency: payment doc id == razorpay payment id. If it already exists,
    // the verify path or an earlier webhook already processed this. Done.
    const paymentRef = paymentsCollection.doc(paymentId);
    const existing = await paymentRef.get();
    if (existing.exists) {
      console.log("Webhook duplicate ignored:", paymentId);
      return res.status(200).json({ status: "duplicate" });
    }

    const orderRef = ordersCollection.doc(resolvedOrderId);

    // Run the full state transition (mark PAID + decrement stock + record
    // payment) atomically. All reads must happen before writes.
    let stockShortfall = false;
    try {
      await firestore.runTransaction(async (tx) => {
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) {
          throw new Error("ORDER_NOT_FOUND");
        }
        const order = orderSnap.data() as Record<string, unknown>;
        const orderStatus = String(order.status || "");

        // Amount validation: webhook-reported amount must equal what we stored.
        // Without this, an attacker who could forge a webhook (impossible with
        // signature) or replay a captured payment from a different order could
        // mark our order PAID with the wrong amount.
        const expectedPaise = Math.round((Number(order.total_amount) || 0) * 100);
        if (amountInPaise !== expectedPaise) {
          console.error("Webhook amount mismatch:", {
            resolvedOrderId,
            amountInPaise,
            expectedPaise,
          });
          throw new Error("AMOUNT_MISMATCH");
        }

        // Re-check payment doc inside the transaction to avoid race with verify.
        const paymentSnap = await tx.get(paymentRef);
        if (paymentSnap.exists) {
          // Verify path beat us; nothing to do.
          return;
        }

        const orderItems = readOrderItems(order);
        const productRefs = orderItems.map((line) =>
          productsCollection.doc(`product-${line.product_id}`)
        );
        const productSnaps = productRefs.length
          ? await Promise.all(productRefs.map((ref) => tx.get(ref)))
          : [];

        // Only decrement stock the FIRST time we transition to PAID. If status
        // is already PAID, the verify endpoint did it.
        const shouldDecrementStock = orderStatus === "PENDING_PAYMENT";

        if (shouldDecrementStock) {
          for (let i = 0; i < orderItems.length; i++) {
            const line = orderItems[i];
            const snap = productSnaps[i];
            if (!snap?.exists) {
              throw new Error(`STOCK_SHORTFALL:${line.product_id}`);
            }
            const stock = Number((snap.data() as Record<string, unknown>).stock_quantity ?? 0);
            if (stock < line.quantity) {
              throw new Error(`STOCK_SHORTFALL:${line.product_id}`);
            }
          }
        }

        if (orderStatus === "PENDING_PAYMENT") {
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

        if (shouldDecrementStock) {
          productSnaps.forEach((snap, idx) => {
            const line = orderItems[idx];
            const stock = Number((snap.data() as Record<string, unknown>).stock_quantity ?? 0);
            tx.update(productRefs[idx], {
              stock_quantity: stock - line.quantity,
              updated_at: Timestamp.now(),
            });
          });
        }
      });
    } catch (txError: any) {
      const message = String(txError?.message || "");
      if (message.startsWith("STOCK_SHORTFALL:")) {
        stockShortfall = true;
        // Persist a payment record marked NEEDS_REFUND so ops can act on it.
        // The money was captured by Razorpay but we can't fulfill the order.
        try {
          await paymentRef.set(
            {
              payment_id: paymentId,
              order_id: resolvedOrderId,
              user_id: resolvedUserId,
              provider: "RAZORPAY",
              provider_order_id: razorpayOrderId,
              provider_payment_id: paymentId,
              provider_signature: signature,
              amount: amountInPaise,
              currency,
              status: "NEEDS_REFUND",
              reason: message,
              idempotency_key: idempotencyKey,
              payment_date: Timestamp.now(),
              updated_at: Timestamp.now(),
            },
            { merge: true }
          );
        } catch (logError) {
          console.error("Failed to write NEEDS_REFUND payment record:", logError);
        }
        // Acknowledge so Razorpay stops retrying.
        return res.status(200).json({ status: "needs_refund", reason: message });
      }
      if (message === "AMOUNT_MISMATCH" || message === "ORDER_NOT_FOUND") {
        console.error("Webhook rejected:", message, paymentId);
        return res.status(200).json({ status: "ignored", reason: message.toLowerCase() });
      }
      throw txError;
    }

    if (resolvedUserId && !stockShortfall) {
      await clearUserCart(resolvedUserId);
    }

    // Fire-and-forget admin notification (idempotent — won't re-send if verify
    // already notified). Never blocks the webhook response.
    if (!stockShortfall) {
      notifyAdminOrderReceived(resolvedOrderId).catch((err) =>
        console.error("admin notify (webhook) failed:", err)
      );
      // Also email the customer their confirmation + invoice. Idempotent guard
      // (customer_confirmation_notified_at) makes this safe even when the verify
      // path already sent it; closes the gap where a prepaid order is confirmed
      // ONLY via webhook (user closed the tab before verify ran).
      notifyCustomerOrderConfirmed(resolvedOrderId).catch(() => undefined);
    }

    console.log("Payment saved via webhook:", paymentId);
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Webhook error:", err);
    // Return 200 to prevent Razorpay retries from amplifying a backend bug;
    // the event is logged for manual investigation.
    return res.status(200).json({ status: "error" });
  }
};
