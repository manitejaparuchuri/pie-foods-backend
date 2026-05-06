import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { getFirestoreProductsCollectionName } from "../config/catalog";
import {
  AppliedCoupon,
  consumeCoupon,
  validateCouponForAmount,
} from "./coupon.service";
import {
  buildPricedItemsAndSubtotal,
  calculateTotalsFromSubtotal,
} from "./pricing.service";

const ordersCollection = firestore.collection("orders");
const usersCollection = firestore.collection("users");
const productsCollection = firestore.collection(getFirestoreProductsCollectionName());

interface CreateOrderResult {
  orderId: string;
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
  orderDate: string | null;
  status: string;
  totalAmount: number;
  subtotalAmount: number;
  couponDiscountAmount: number;
  finalAmount: number;
  couponCode: string | null;
  shippingId: string;
  items: OrderHistoryItem[];
}

interface CartLineForOrder {
  product_id: number;
  quantity: number;
  price: number;
  name: string;
  image_url: string | null;
}

async function fetchProductSummary(productId: number): Promise<{
  name: string;
  price: number;
  image_url: string | null;
} | null> {
  const snap = await productsCollection
    .where("product_id", "==", productId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const data = snap.docs[0].data() as Record<string, unknown>;
  return {
    name: String(data.name || ""),
    price: Number(data.price) || 0,
    image_url: (data.image_url as string) || null,
  };
}

async function loadCartLines(uid: string): Promise<CartLineForOrder[]> {
  const cartSnap = await usersCollection.doc(uid).collection("cart").get();
  if (cartSnap.empty) return [];

  const lines = await Promise.all(
    cartSnap.docs.map(async (doc) => {
      const data = doc.data() as Record<string, unknown>;
      const productId = Number(doc.id);
      if (!Number.isFinite(productId) || productId <= 0) return null;
      const product = await fetchProductSummary(productId);
      if (!product) return null;
      return {
        product_id: productId,
        quantity: Number(data.quantity) || 0,
        price: product.price,
        name: product.name,
        image_url: product.image_url,
      };
    })
  );

  return lines.filter((line): line is CartLineForOrder => line !== null && line.quantity > 0);
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

    const result = await firestore.runTransaction(async (tx) => {
      const preCouponTotals = calculateTotalsFromSubtotal(subtotalPaise, 0);
      const appliedCoupon: AppliedCoupon | null = await validateCouponForAmount(
        tx,
        uid,
        preCouponTotals.subtotalAmount,
        couponCode
      );
      const totals = calculateTotalsFromSubtotal(
        subtotalPaise,
        appliedCoupon?.discountAmount || 0
      );

      const orderRef = ordersCollection.doc();
      const itemsForStorage = pricedItems.map((priced) => {
        const cartLine = cartLines.find((line) => line.product_id === priced.product_id);
        return {
          product_id: priced.product_id,
          name: cartLine?.name || "",
          image_url: cartLine?.image_url || null,
          quantity: priced.quantity,
          price: priced.discountedPrice,
          line_total: priced.lineTotal,
        };
      });

      tx.set(orderRef, {
        order_id: orderRef.id,
        user_id: uid,
        status: orderStatus,
        shipping_id: shippingId,
        payment_method: normalizedPaymentMethod,
        provider_order_id: null,
        coupon_id: appliedCoupon?.couponId || null,
        coupon_code: appliedCoupon?.code || null,
        subtotal_amount: totals.subtotalAmount,
        coupon_discount_amount: totals.couponDiscountAmount,
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
      const itemsRaw = Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
        : [];
      return {
        orderId: doc.id,
        orderDate: orderDate ? orderDate.toDate().toISOString() : null,
        status: String(data.status || ""),
        totalAmount: Number(data.total_amount) || 0,
        subtotalAmount: Number(data.subtotal_amount) || 0,
        couponDiscountAmount: Number(data.coupon_discount_amount) || 0,
        finalAmount: Number(data.final_amount) || 0,
        couponCode: (data.coupon_code as string) || null,
        shippingId: String(data.shipping_id || ""),
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
