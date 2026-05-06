import { FieldValue, Timestamp, Transaction } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";

const couponsCollection = firestore.collection("coupons");

const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toNullableDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

interface CouponDoc {
  code: string;
  discount_type: "PERCENT" | "FIXED";
  discount_value: number;
  max_discount_amount: number | null;
  min_order_amount: number;
  starts_at: Timestamp | string | null;
  expires_at: Timestamp | string | null;
  usage_limit_total: number | null;
  usage_limit_per_user: number | null;
  used_count: number;
  is_active: boolean;
}

export interface AppliedCoupon {
  couponId: string;
  code: string;
  discountAmount: number;
}

export const COUPON_ERRORS = {
  INVALID: "Invalid coupon code",
  INACTIVE: "Coupon is inactive",
  NOT_STARTED: "Coupon is not active yet",
  EXPIRED: "Coupon is expired",
  MIN_ORDER: "Order does not meet minimum amount for this coupon",
  LIMIT_REACHED: "Coupon usage limit reached",
  LIMIT_USER: "Coupon usage limit reached for this user",
};

/**
 * Reads a coupon by code (case-insensitive) inside a transaction.
 * Returns null if no coupon was requested.
 */
export const validateCouponForAmount = async (
  tx: Transaction,
  uid: string,
  subtotalAmount: number,
  rawCouponCode?: unknown
): Promise<AppliedCoupon | null> => {
  const couponCode = String(rawCouponCode || "").trim().toUpperCase();
  if (!couponCode) {
    return null;
  }

  const couponRef = couponsCollection.doc(couponCode);
  const couponSnap = await tx.get(couponRef);
  if (!couponSnap.exists) {
    throw new Error(COUPON_ERRORS.INVALID);
  }

  const coupon = couponSnap.data() as CouponDoc;
  const now = new Date();
  const startsAt = toNullableDate(coupon.starts_at);
  const expiresAt = toNullableDate(coupon.expires_at);

  if (!coupon.is_active) {
    throw new Error(COUPON_ERRORS.INACTIVE);
  }
  if (startsAt && startsAt.getTime() > now.getTime()) {
    throw new Error(COUPON_ERRORS.NOT_STARTED);
  }
  if (expiresAt && expiresAt.getTime() < now.getTime()) {
    throw new Error(COUPON_ERRORS.EXPIRED);
  }

  const minOrderAmount = Number(coupon.min_order_amount) || 0;
  if (subtotalAmount < minOrderAmount) {
    throw new Error(COUPON_ERRORS.MIN_ORDER);
  }

  if (
    coupon.usage_limit_total !== null &&
    coupon.usage_limit_total !== undefined &&
    Number(coupon.used_count || 0) >= Number(coupon.usage_limit_total)
  ) {
    throw new Error(COUPON_ERRORS.LIMIT_REACHED);
  }

  if (coupon.usage_limit_per_user !== null && coupon.usage_limit_per_user !== undefined) {
    const usageQuery = await couponRef
      .collection("usages")
      .where("user_id", "==", uid)
      .count()
      .get();
    const usageCount = usageQuery.data().count;
    if (usageCount >= Number(coupon.usage_limit_per_user)) {
      throw new Error(COUPON_ERRORS.LIMIT_USER);
    }
  }

  const discountType = String(coupon.discount_type).toUpperCase();
  const discountValue = Number(coupon.discount_value) || 0;
  let discountAmount =
    discountType === "PERCENT"
      ? (subtotalAmount * discountValue) / 100
      : discountValue;

  if (
    discountType === "PERCENT" &&
    coupon.max_discount_amount !== null &&
    coupon.max_discount_amount !== undefined
  ) {
    const maxDiscountAmount = Number(coupon.max_discount_amount) || 0;
    discountAmount = Math.min(discountAmount, maxDiscountAmount);
  }

  discountAmount = roundCurrency(Math.max(0, Math.min(discountAmount, subtotalAmount)));

  if (discountAmount <= 0) {
    throw new Error(COUPON_ERRORS.INVALID);
  }

  return {
    couponId: couponCode,
    code: String(coupon.code || couponCode),
    discountAmount,
  };
};

/**
 * Records coupon usage and increments the counter inside the order transaction.
 */
export const consumeCoupon = async (
  tx: Transaction,
  uid: string,
  orderId: string,
  coupon: AppliedCoupon
): Promise<void> => {
  const couponRef = couponsCollection.doc(coupon.couponId);
  const usageRef = couponRef.collection("usages").doc(`${orderId}`);

  tx.set(usageRef, {
    coupon_id: coupon.couponId,
    user_id: uid,
    order_id: orderId,
    code_snapshot: coupon.code,
    discount_amount: coupon.discountAmount,
    redeemed_at: Timestamp.now(),
  });

  tx.update(couponRef, {
    used_count: FieldValue.increment(1),
  });
};
