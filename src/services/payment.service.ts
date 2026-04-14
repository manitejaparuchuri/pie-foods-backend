import getRazorpayClient from "../config/razorpay";
import pool from "../config/db";
import crypto from "crypto";

/* ================= CREATE RAZORPAY ORDER ================= */

export const createRazorpayOrderService = async (
  order_id: number,
  userId: number
) => {
  const razorpay = getRazorpayClient();

  const [rows]: any = await pool.query(
    "SELECT * FROM orders WHERE order_id = ? AND user_id = ?",
    [order_id, userId]
  );

  if (!rows.length) {
    throw new Error("Order not found or unauthorized");
  }

  const order = rows[0];

  if (order.status !== "PENDING_PAYMENT") {
    throw new Error("Order not eligible for payment");
  }

  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(Number(order.total_amount) * 100),
    currency: "INR",
    receipt: `receipt_${order_id}`,
    notes: {
      order_id: order_id.toString(),
    },
  });

  await pool.query(
    "UPDATE orders SET provider_order_id = ? WHERE order_id = ?",
    [razorpayOrder.id, order_id]
  );

  return razorpayOrder;
};

/* ================= VERIFY PAYMENT (FRONTEND FLOW) ================= */

export const verifyPaymentService = async (
  razorpay_order_id: string,
  razorpay_payment_id: string,
  razorpay_signature: string,
  order_id: number,
  userId: number
) => {
  const razorpay = getRazorpayClient();
  const connection = await pool.getConnection();

  try {
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

    // Fallback: if signature compare fails, verify payment with Razorpay API.
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

    const [orders]: any = await connection.query(
      "SELECT status, total_amount, provider_order_id FROM orders WHERE order_id=? AND user_id=?",
      [order_id, userId]
    );

    if (!orders.length) {
      throw new Error("Order not found or unauthorized");
    }

    const savedProviderOrderId = String(orders[0].provider_order_id || "").trim();

    if (savedProviderOrderId && savedProviderOrderId !== normalizedRazorpayOrderId) {
      throw new Error("Order mapping mismatch");
    }

    if (!savedProviderOrderId) {
      await connection.query(
        "UPDATE orders SET provider_order_id=? WHERE order_id=? AND user_id=?",
        [normalizedRazorpayOrderId, order_id, userId]
      );
    }

    const [existingPayments]: any = await connection.query(
      "SELECT payment_id FROM payments WHERE provider_payment_id=? LIMIT 1",
      [normalizedRazorpayPaymentId]
    );

    if (existingPayments.length > 0) {
      await connection.beginTransaction();
      await connection.query(
        "UPDATE orders SET status='PAID', provider_order_id=? WHERE order_id=? AND user_id=?",
        [normalizedRazorpayOrderId, order_id, userId]
      );
      await connection.query("DELETE FROM cart_items WHERE user_id=?", [userId]);
      await connection.commit();
      return true;
    }

    if (!providerPayment) {
      try {
        providerPayment = await razorpay.payments.fetch(normalizedRazorpayPaymentId);
      } catch {
        providerPayment = null;
      }
    }

    // payments.amount is BIGINT, so persist paise (integer).
    const amountInPaise = Number.isFinite(Number(providerPayment?.amount))
      ? Number(providerPayment.amount)
      : Math.round(Number(orders[0].total_amount) * 100);
    const currency = String(providerPayment?.currency || "INR").toUpperCase();
    const idempotencyKey = `rzp_verify_${normalizedRazorpayPaymentId}`.slice(0, 64);

    if (!Number.isFinite(amountInPaise) || amountInPaise <= 0) {
      throw new Error("Invalid payment amount");
    }

    await connection.beginTransaction();

    await connection.query(
      "UPDATE orders SET status='PAID', provider_order_id=? WHERE order_id=? AND user_id=?",
      [normalizedRazorpayOrderId, order_id, userId]
    );

    await connection.query(
      `INSERT INTO payments
      (order_id, provider, provider_order_id, provider_payment_id, provider_signature, amount, currency, status, idempotency_key, payment_date, updated_at)
      VALUES (?, 'RAZORPAY', ?, ?, ?, ?, ?, 'SUCCESS', ?, NOW(), NOW())`,
      [
        order_id,
        normalizedRazorpayOrderId,
        normalizedRazorpayPaymentId,
        normalizedSignature,
        amountInPaise,
        currency,
        idempotencyKey,
      ]
    );

    await connection.query("DELETE FROM cart_items WHERE user_id=?", [userId]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
