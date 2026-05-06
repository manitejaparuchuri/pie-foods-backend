import { Response } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { getFirestoreProductsCollectionName } from "../config/catalog";
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

const ordersCollection = firestore.collection("orders");
const usersCollection = firestore.collection("users");
const productsCollection = firestore.collection(getFirestoreProductsCollectionName());

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

interface ProductSummary {
  name: string;
  price: number;
  image_url: string | null;
}

async function fetchProductsByIds(ids: number[]): Promise<Map<number, ProductSummary>> {
  if (ids.length === 0) return new Map();
  const snaps = await Promise.all(
    ids.map((id) =>
      productsCollection.where("product_id", "==", id).limit(1).get()
    )
  );
  const map = new Map<number, ProductSummary>();
  snaps.forEach((snap, idx) => {
    if (snap.empty) return;
    const data = snap.docs[0].data() as Record<string, unknown>;
    map.set(ids[idx], {
      name: String(data.name || ""),
      price: Number(data.price) || 0,
      image_url: (data.image_url as string) || null,
    });
  });
  return map;
}

export const checkout = async (req: AuthRequest, res: Response) => {
  const uid = req.user?.uid;
  if (!uid) {
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

  try {
    const shippingSnap = await usersCollection
      .doc(uid)
      .collection("addresses")
      .doc(shippingId)
      .get();

    if (!shippingSnap.exists) {
      return res.status(400).json({ message: "Invalid shipping address" });
    }

    const uniqueProductIds = Array.from(new Set(parsedItems.map((i) => i.product_id)));
    const productMap = await fetchProductsByIds(uniqueProductIds);

    if (productMap.size !== uniqueProductIds.length) {
      return res.status(400).json({ message: "One or more products are invalid" });
    }

    const { pricedItems, subtotalPaise } = buildPricedItemsAndSubtotal(
      parsedItems.map((item) => ({
        productId: item.product_id,
        quantity: item.quantity,
        mrpRupees: productMap.get(item.product_id)?.price ?? 0,
      }))
    );

    const result = await firestore.runTransaction(async (tx) => {
      const preCouponTotals = calculateTotalsFromSubtotal(subtotalPaise, 0);
      const appliedCoupon = await validateCouponForAmount(
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
        const product = productMap.get(priced.product_id);
        return {
          product_id: priced.product_id,
          name: product?.name || "",
          image_url: product?.image_url || null,
          quantity: priced.quantity,
          price: priced.discountedPrice,
          line_total: priced.lineTotal,
        };
      });

      tx.set(orderRef, {
        order_id: orderRef.id,
        user_id: uid,
        status: "PENDING_PAYMENT",
        shipping_id: shippingId,
        payment_method: "RAZORPAY",
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
          ? { code: appliedCoupon.code, discount_amount: totals.couponDiscountAmount }
          : null,
      };
    });

    return res.status(201).json({
      message: "Order placed successfully",
      order_id: result.orderId,
      coupon: result.coupon,
      total_amount: result.totalAmount,
    });
  } catch (error: any) {
    console.error("CHECKOUT ERROR:", error?.message || error);
    const safeCouponErrors = new Set(Object.values(COUPON_ERRORS));
    const message = String(error?.message || "");
    if (safeCouponErrors.has(message)) {
      return res.status(400).json({ message });
    }
    if (message === "Invalid shipping address" || message === "Cart is empty") {
      return res.status(400).json({ message });
    }
    return res.status(500).json({ message: "Server error during checkout" });
  }
};
