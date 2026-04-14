const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const toNullableDate = (value: unknown): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

interface CouponRow {
  coupon_id: number;
  code: string;
  discount_type: "PERCENT" | "FIXED";
  discount_value: number | string;
  max_discount_amount: number | string | null;
  min_order_amount: number | string;
  starts_at: Date | string | null;
  expires_at: Date | string | null;
  usage_limit_total: number | null;
  usage_limit_per_user: number | null;
  used_count: number;
  is_active: number;
}

export interface AppliedCoupon {
  couponId: number;
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

export const validateCouponForAmount = async (
  connection: any,
  userId: number,
  subtotalAmount: number,
  rawCouponCode?: unknown
): Promise<AppliedCoupon | null> => {
  const couponCode = String(rawCouponCode || "").trim().toUpperCase();
  if (!couponCode) {
    return null;
  }

  const [rows]: [CouponRow[], unknown] = await connection.query(
    `SELECT
      coupon_id,
      code,
      discount_type,
      discount_value,
      max_discount_amount,
      min_order_amount,
      starts_at,
      expires_at,
      usage_limit_total,
      usage_limit_per_user,
      used_count,
      is_active
     FROM coupons
     WHERE UPPER(code) = ?
     LIMIT 1
     FOR UPDATE`,
    [couponCode]
  );

  if (!rows.length) {
    throw new Error(COUPON_ERRORS.INVALID);
  }

  const coupon = rows[0];
  const now = new Date();
  const startsAt = toNullableDate(coupon.starts_at);
  const expiresAt = toNullableDate(coupon.expires_at);

  if (!Number(coupon.is_active)) {
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
    Number(coupon.used_count) >= Number(coupon.usage_limit_total)
  ) {
    throw new Error(COUPON_ERRORS.LIMIT_REACHED);
  }

  if (coupon.usage_limit_per_user !== null) {
    const [usageRows]: any = await connection.query(
      `SELECT COUNT(*) AS usage_count
       FROM coupon_usages
       WHERE coupon_id = ? AND user_id = ?`,
      [coupon.coupon_id, userId]
    );
    const usageCount = Number(usageRows?.[0]?.usage_count || 0);
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

  if (discountType === "PERCENT" && coupon.max_discount_amount !== null) {
    const maxDiscountAmount = Number(coupon.max_discount_amount) || 0;
    discountAmount = Math.min(discountAmount, maxDiscountAmount);
  }

  discountAmount = roundCurrency(Math.max(0, Math.min(discountAmount, subtotalAmount)));

  if (discountAmount <= 0) {
    throw new Error(COUPON_ERRORS.INVALID);
  }

  return {
    couponId: Number(coupon.coupon_id),
    code: String(coupon.code),
    discountAmount,
  };
};

export const consumeCoupon = async (
  connection: any,
  userId: number,
  orderId: number,
  coupon: AppliedCoupon
) => {
  await connection.query(
    `INSERT INTO coupon_usages
      (coupon_id, user_id, order_id, code_snapshot, discount_amount, redeemed_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [coupon.couponId, userId, orderId, coupon.code, coupon.discountAmount]
  );

  const [updateResult]: any = await connection.query(
    `UPDATE coupons
     SET used_count = used_count + 1
     WHERE coupon_id = ?
       AND (usage_limit_total IS NULL OR used_count < usage_limit_total)`,
    [coupon.couponId]
  );

  if (!Number(updateResult?.affectedRows || 0)) {
    throw new Error(COUPON_ERRORS.LIMIT_REACHED);
  }
};

