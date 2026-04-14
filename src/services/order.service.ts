import db from "../config/db";
import {
  AppliedCoupon,
  consumeCoupon,
  validateCouponForAmount,
} from "./coupon.service";
import {
  buildPricedItemsAndSubtotal,
  calculateTotalsFromSubtotal,
} from "./pricing.service";

interface CreateOrderResult {
  orderId: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  status: string;
  coupon: { code: string; discountAmount: number } | null;
}

type PaymentMethod = "RAZORPAY" | "COD";

interface OrderHistoryItem {
  productId: number;
  name: string;
  imageUrl: string | null;
  quantity: number;
  price: number;
}

interface OrderHistory {
  orderId: number;
  orderDate: Date | null;
  status: string;
  totalAmount: number;
  subtotalAmount: number;
  couponDiscountAmount: number;
  finalAmount: number;
  couponCode: string | null;
  shippingId: string;
  items: OrderHistoryItem[];
}

interface OrderHistoryRow {
  order_id: number;
  order_date: Date | null;
  status: string;
  total_amount: number | string;
  subtotal_amount: number | string | null;
  coupon_discount_amount: number | string | null;
  final_amount: number | string | null;
  coupon_code: string | null;
  shipping_id: string;
  product_id: number | null;
  product_name: string | null;
  image_url: string | null;
  quantity: number | string | null;
  price: number | string | null;
}

class OrderService {
  static async createOrder(
    userId: number,
    shippingId: string,
    paymentMethod: PaymentMethod = "RAZORPAY",
    couponCode?: string
  ): Promise<CreateOrderResult> {
    const connection = await db.getConnection();
    const normalizedPaymentMethod: PaymentMethod =
      paymentMethod === "COD" ? "COD" : "RAZORPAY";
    const orderStatus = "PENDING_PAYMENT";

    try {
      await connection.beginTransaction();

     
      const [shippingRows]: any = await connection.query(
        `SELECT shipping_id FROM shipping_info WHERE shipping_id = ? AND user_id = ?`,
        [shippingId, userId]
      );

      if (shippingRows.length === 0) {
        throw new Error("Invalid shipping address");
      }


      const [cartItems]: any = await connection.query(
        `SELECT c.product_id, c.quantity, p.price
         FROM cart_items c
         JOIN products            p ON p.product_id = c.product_id
         WHERE c.user_id = ?`,
        [userId]
      );

      if (cartItems.length === 0) {
        throw new Error("Cart is empty");
      }

      
      const { pricedItems, subtotalPaise } = buildPricedItemsAndSubtotal(
        cartItems.map((item: any) => ({
          productId: Number(item.product_id),
          quantity: Number(item.quantity) || 0,
          mrpRupees: Number(item.price) || 0,
        }))
      );

      const preCouponTotals = calculateTotalsFromSubtotal(subtotalPaise, 0);
      const appliedCoupon: AppliedCoupon | null = await validateCouponForAmount(
        connection,
        userId,
        preCouponTotals.subtotalAmount,
        couponCode
      );
      const totals = calculateTotalsFromSubtotal(subtotalPaise, appliedCoupon?.discountAmount || 0);

      const [orderResult]: any = await connection.query(
        `INSERT INTO orders
        (user_id, total_amount, status, shipping_id, coupon_id, coupon_code, subtotal_amount, coupon_discount_amount, final_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          totals.totalAmount,
          orderStatus,
          shippingId,
          appliedCoupon?.couponId || null,
          appliedCoupon?.code || null,
          totals.subtotalAmount,
          totals.couponDiscountAmount,
          totals.totalAmount,
        ]
      );

      const orderId = orderResult.insertId;

      
      for (const item of pricedItems) {
        await connection.query(
          `INSERT INTO order_items (order_id, product_id, quantity, price)
           VALUES (?, ?, ?, ?)`,
          [orderId, item.product_id, item.quantity, item.discountedPrice]
        );
      }

      if (appliedCoupon) {
        await consumeCoupon(connection, userId, Number(orderId), appliedCoupon);
      }

      if (normalizedPaymentMethod === "COD") {
        await connection.query("DELETE FROM cart_items WHERE user_id = ?", [userId]);
      }

      await connection.commit();

      return {
        orderId,
        totalAmount: totals.totalAmount,
        paymentMethod: normalizedPaymentMethod,
        status: orderStatus,
        coupon: appliedCoupon
          ? { code: appliedCoupon.code, discountAmount: totals.couponDiscountAmount }
          : null,
      };

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async getOrdersByUser(userId: number): Promise<OrderHistory[]> {
    const [rows] = await db.query(
      `SELECT
        o.order_id,
        o.order_date,
        o.status,
        o.total_amount,
        o.subtotal_amount,
        o.coupon_discount_amount,
        o.final_amount,
        o.coupon_code,
        o.shipping_id,
        oi.product_id,
        p.name AS product_name,
        p.image_url,
        oi.quantity,
        oi.price
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.order_id
      LEFT JOIN products p ON p.product_id = oi.product_id
      WHERE o.user_id = ?
      ORDER BY o.order_date DESC, o.order_id DESC`,
      [userId]
    ) as [OrderHistoryRow[], unknown];

    const byOrder = new Map<number, OrderHistory>();

    for (const row of rows) {
      let order = byOrder.get(row.order_id);
      if (!order) {
        order = {
          orderId: row.order_id,
          orderDate: row.order_date ?? null,
          status: row.status,
          totalAmount: Number(row.total_amount) || 0,
          subtotalAmount: Number(row.subtotal_amount) || 0,
          couponDiscountAmount: Number(row.coupon_discount_amount) || 0,
          finalAmount: Number(row.final_amount) || 0,
          couponCode: row.coupon_code ?? null,
          shippingId: row.shipping_id,
          items: []
        };
        byOrder.set(row.order_id, order);
      }

      if (row.product_id) {
        order.items.push({
          productId: row.product_id,
          name: row.product_name ?? "Product",
          imageUrl: row.image_url ?? null,
          quantity: Number(row.quantity) || 1,
          price: Number(row.price) || 0
        });
      }
    }

    return Array.from(byOrder.values());
  }
}


export default OrderService;
