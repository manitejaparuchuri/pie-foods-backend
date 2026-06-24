import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import {
  AppliedCoupon,
  consumeCoupon,
  validateCouponForAmount,
} from "./coupon.service";
import { generateOrderNumber } from "./order-number.service";
import {
  buildPricedItemsAndSubtotal,
  calculateTotalsFromSubtotal,
} from "./pricing.service";
import { fetchProductsByIds } from "./product-lookup.service";

const ordersCollection = firestore.collection("orders");
const usersCollection = firestore.collection("users");

interface CreateOrderResult {
  orderId: string;
  orderNumber: string;
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
  orderId: string;
  orderNumber: string | null;
  orderDate: string | null;
  status: string;
  totalAmount: number;
  subtotalAmount: number;
  couponDiscountAmount: number;
  finalAmount: number;
  couponCode: string | null;
  shippingId: string;
  trackingWaybill: string | null;
  trackingStatus: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  items: OrderHistoryItem[];
}

interface CartLineForOrder {
  product_id: number;
  quantity: number;
  price: number;
  /** Per-product GST rate to snapshot onto the order item for invoice rendering. */
  tax_percent: number;
  name: string;
  image_url: string | null;
}

async function loadCartLines(uid: string): Promise<CartLineForOrder[]> {
  const cartSnap = await usersCollection.doc(uid).collection("cart").get();
  if (cartSnap.empty) return [];

  const productIds = cartSnap.docs
    .map((doc) => Number(doc.id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const productMap = await fetchProductsByIds(productIds);

  return cartSnap.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const productId = Number(doc.id);
      if (!Number.isFinite(productId) || productId <= 0) return null;
      const product = productMap.get(productId);
      if (!product) return null;
      return {
        product_id: productId,
        quantity: Number(data.quantity) || 0,
        price: product.price,
        tax_percent: product.tax_percent,
        name: product.name,
        image_url: product.image_url,
      };
    })
    .filter((line): line is CartLineForOrder => line !== null && line.quantity > 0);
}

async function clearUserCart(uid: string): Promise<void> {
  const snap = await usersCollection.doc(uid).collection("cart").get();
  if (snap.empty) return;
  const batch = firestore.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

class OrderService {
  static async createOrder(
    uid: string,
    shippingId: string,
    paymentMethod: PaymentMethod = "RAZORPAY",
    couponCode?: string
  ): Promise<CreateOrderResult> {
    const normalizedPaymentMethod: PaymentMethod =
      paymentMethod === "COD" ? "COD" : "RAZORPAY";
    const orderStatus = "PENDING_PAYMENT";

    const shippingRef = usersCollection.doc(uid).collection("addresses").doc(shippingId);
    const shippingSnap = await shippingRef.get();
    if (!shippingSnap.exists) {
      throw new Error("Invalid shipping address");
    }

    const cartLines = await loadCartLines(uid);
    if (cartLines.length === 0) {
      throw new Error("Cart is empty");
    }

    const { pricedItems, subtotalPaise } = buildPricedItemsAndSubtotal(
      cartLines.map((line) => ({
        productId: line.product_id,
        quantity: line.quantity,
        mrpRupees: line.price,
      }))
    );

    // Pre-generate the friendly order number (its own atomic txn).
    // If the order-create txn fails, the counter still ticks forward — a
    // small gap in the sequence is harmless.
    const orderNumber = await generateOrderNumber();

    const result = await firestore.runTransaction(async (tx) => {
      const preCouponTotals = calculateTotalsFromSubtotal(
        subtotalPaise,
        0,
        normalizedPaymentMethod
      );
      const appliedCoupon: AppliedCoupon | null = await validateCouponForAmount(
        tx,
        uid,
        preCouponTotals.subtotalAmount,
        couponCode
      );
      const totals = calculateTotalsFromSubtotal(
        subtotalPaise,
        appliedCoupon?.discountAmount || 0,
        normalizedPaymentMethod
      );

      const orderRef = ordersCollection.doc();
      const itemsForStorage = pricedItems.map((priced) => {
        const cartLine = cartLines.find((line) => line.product_id === priced.product_id);
        return {
          product_id: priced.product_id,
          name: cartLine?.name || "",
          image_url: cartLine?.image_url || null,
          quantity: priced.quantity,
          // Snapshotted on the order so the invoice keeps rendering correctly
          // even if the underlying product's MRP/tax rate changes later.
          mrp: priced.mrp,
          price: priced.discountedPrice,
          tax_percent: cartLine?.tax_percent ?? 5,
          line_total: priced.lineTotal,
        };
      });

      tx.set(orderRef, {
        order_id: orderRef.id,
        order_number: orderNumber,
        user_id: uid,
        status: orderStatus,
        shipping_id: shippingId,
        payment_method: normalizedPaymentMethod,
        provider_order_id: null,
        coupon_id: appliedCoupon?.couponId || null,
        coupon_code: appliedCoupon?.code || null,
        subtotal_amount: totals.subtotalAmount,
        coupon_discount_amount: totals.couponDiscountAmount,
        shipping_amount: totals.shippingAmount,
        cod_surcharge_amount: totals.codSurchargeAmount,
        cgst_amount: totals.cgstAmount,
        sgst_amount: totals.sgstAmount,
        final_amount: totals.totalAmount,
        total_amount: totals.totalAmount,
        items: itemsForStorage,
        order_date: Timestamp.now(),
        updated_at: Timestamp.now(),
      });

      if (appliedCoupon) {
        await consumeCoupon(tx, uid, orderRef.id, appliedCoupon);
      }

      return {
        orderId: orderRef.id,
        orderNumber,
        totalAmount: totals.totalAmount,
        coupon: appliedCoupon
          ? { code: appliedCoupon.code, discountAmount: totals.couponDiscountAmount }
          : null,
      };
    });

    if (normalizedPaymentMethod === "COD") {
      await clearUserCart(uid);
    }

    return {
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      totalAmount: result.totalAmount,
      paymentMethod: normalizedPaymentMethod,
      status: orderStatus,
      coupon: result.coupon,
    };
  }

  static async getOrdersByUser(uid: string): Promise<OrderHistory[]> {
    const snap = await ordersCollection.where("user_id", "==", uid).get();
    const orders: OrderHistory[] = snap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const orderDate = data.order_date as Timestamp | undefined;
      const shippedAt = data.shipped_at as Timestamp | undefined;
      const deliveredAt = data.delivered_at as Timestamp | undefined;
      const itemsRaw = Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
        : [];
      return {
        orderId: doc.id,
        orderNumber: data.order_number ? String(data.order_number) : null,
        orderDate: orderDate ? orderDate.toDate().toISOString() : null,
        status: String(data.status || ""),
        totalAmount: Number(data.total_amount) || 0,
        subtotalAmount: Number(data.subtotal_amount) || 0,
        couponDiscountAmount: Number(data.coupon_discount_amount) || 0,
        finalAmount: Number(data.final_amount) || 0,
        couponCode: (data.coupon_code as string) || null,
        shippingId: String(data.shipping_id || ""),
        trackingWaybill: data.tracking_waybill ? String(data.tracking_waybill) : null,
        trackingStatus: data.tracking_status ? String(data.tracking_status) : null,
        shippedAt: shippedAt ? shippedAt.toDate().toISOString() : null,
        deliveredAt: deliveredAt ? deliveredAt.toDate().toISOString() : null,
        items: itemsRaw.map((item) => ({
          productId: Number(item.product_id) || 0,
          name: String(item.name || "Product"),
          imageUrl: (item.image_url as string) || null,
          quantity: Number(item.quantity) || 0,
          price: Number(item.price) || 0,
        })),
      };
    });

    orders.sort((a, b) => {
      const at = a.orderDate ? new Date(a.orderDate).getTime() : 0;
      const bt = b.orderDate ? new Date(b.orderDate).getTime() : 0;
      return bt - at;
    });
    return orders;
  }
}

export default OrderService;
