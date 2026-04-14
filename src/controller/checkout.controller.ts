import { Response } from "express";
import db from "../config/db";
import { AuthRequest } from "../middlewares/auth";
import {
  COUPON_ERRORS,
  consumeCoupon,
  validateCouponForAmount,
} from "../services/coupon.service";
import {
  buildPricedItemsAndSubtotal,
  calculateTotalsFromSubtotal,
} from "../services/pricing.service";

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

interface CheckoutItemInput {
  product_id: number;
  quantity: number;
}

export const checkout = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const shippingId = String(req.body?.shipping_id || req.body?.shippingId || "").trim();
  const couponCode = String(req.body?.coupon_code || req.body?.couponCode || "").trim();
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!shippingId || rawItems.length === 0) {
    return res.status(400).json({ message: "Missing order details" });
  }

  const parsedItems: CheckoutItemInput[] = [];
  for (const rawItem of rawItems) {
    const productId = parsePositiveInt(rawItem?.product_id ?? rawItem?.productId);
    const quantity = parsePositiveInt(rawItem?.quantity);
    if (!productId || !quantity) {
      return res.status(400).json({ message: "Invalid item payload" });
    }
    parsedItems.push({ product_id: productId, quantity });
  }

  const uniqueProductIds = Array.from(new Set(parsedItems.map((item) => item.product_id)));
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [shippingRows]: any = await connection.query(
      `SELECT shipping_id FROM shipping_info WHERE shipping_id = ? AND user_id = ? LIMIT 1`,
      [shippingId, userId]
    );

    if (!shippingRows.length) {
      await connection.rollback();
      return res.status(400).json({ message: "Invalid shipping address" });
    }

    const [productRows]: any = await connection.query(
      `SELECT product_id, price FROM products WHERE product_id IN (?)`,
      [uniqueProductIds]
    );

    if (productRows.length !== uniqueProductIds.length) {
      await connection.rollback();
      return res.status(400).json({ message: "One or more products are invalid" });
    }

    const priceByProductId = new Map<number, number>();
    for (const row of productRows) {
      priceByProductId.set(Number(row.product_id), Number(row.price) || 0);
    }

    const { pricedItems, subtotalPaise } = buildPricedItemsAndSubtotal(
      parsedItems.map((item) => ({
        productId: item.product_id,
        quantity: item.quantity,
        mrpRupees: priceByProductId.get(item.product_id) ?? 0,
      }))
    );

    const preCouponTotals = calculateTotalsFromSubtotal(subtotalPaise, 0);
    const appliedCoupon = await validateCouponForAmount(
      connection,
      userId,
      preCouponTotals.subtotalAmount,
      couponCode
    );
    const totals = calculateTotalsFromSubtotal(subtotalPaise, appliedCoupon?.discountAmount || 0);

    const [orderResult]: any = await connection.query(
      `INSERT INTO orders
      (user_id, status, total_amount, shipping_id, coupon_id, coupon_code, subtotal_amount, coupon_discount_amount, final_amount)
      VALUES (?, 'PENDING_PAYMENT', ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        totals.totalAmount,
        shippingId,
        appliedCoupon?.couponId || null,
        appliedCoupon?.code || null,
        totals.subtotalAmount,
        totals.couponDiscountAmount,
        totals.totalAmount,
      ]
    );

    const order_id = Number(orderResult.insertId);

    for (const item of pricedItems) {
      await connection.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES (?, ?, ?, ?)`,
        [order_id, item.product_id, item.quantity, item.discountedPrice]
      );
    }

    if (appliedCoupon) {
      await consumeCoupon(connection, userId, order_id, appliedCoupon);
    }

    await connection.commit();

    return res.status(201).json({
      message: "Order placed successfully",
      order_id,
      coupon: appliedCoupon
        ? {
            code: appliedCoupon.code,
            discount_amount: totals.couponDiscountAmount,
          }
        : null,
      total_amount: totals.totalAmount,
    });
  } catch (error) {
    await connection.rollback();
    console.error("CHECKOUT ERROR:", error);
    const safeCouponErrors = new Set(Object.values(COUPON_ERRORS));
    const message = String((error as any)?.message || "");
    if (safeCouponErrors.has(message)) {
      return res.status(400).json({ message });
    }
    return res.status(500).json({ message: "Server error during checkout" });
  } finally {
    connection.release();
  }
};
