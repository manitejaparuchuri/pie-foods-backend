import { Request, Response } from "express";
import jwt from "jsonwebtoken";

import { firestore } from "../config/firebase";
import { validateCouponForAmount } from "../services/coupon.service";

/** Optional auth: read uid from the bearer token if present, else "". Lets the
 *  storefront preview a coupon for both logged-in users and guests. Per-user
 *  usage limits are only enforced when a uid is known (and again, authoritatively,
 *  at order-creation time). */
function uidFromRequest(req: Request): string {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return "";
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
      uid?: string;
    };
    return String(decoded?.uid || "");
  } catch {
    return "";
  }
}

/**
 * POST /api/coupons/validate  { code, subtotal }
 * Previews a coupon WITHOUT placing an order, returning the discount so the
 * storefront can show the real discounted total before checkout. Reuses the
 * exact order-time validation inside a read-only transaction (no writes), so
 * the preview matches what will actually be applied.
 *
 * SECURITY: every failure branch (unknown code, inactive, expired, not yet
 * active, min-order, usage-limit) returns the SAME generic message. The
 * underlying reasons still flow through the throw for admin logging (order
 * creation surfaces them safely because the user is authenticated), but the
 * public preview must not distinguish — otherwise an attacker can brute-force
 * codes and tell valid-but-restricted ones from unknown strings. Rate-limited
 * separately at the router with a strict per-IP quota.
 */
const GENERIC_COUPON_ERROR = "This coupon can't be applied.";

export const validateCoupon = async (req: Request, res: Response) => {
  try {
    const code = String(req.body?.code || "").trim();
    const subtotal = Number(req.body?.subtotal);

    if (!code) {
      return res.status(400).json({ message: GENERIC_COUPON_ERROR });
    }
    if (!Number.isFinite(subtotal) || subtotal <= 0) {
      // Bad request shape — safe to distinguish, this isn't a coupon-existence signal.
      return res.status(400).json({ message: "A valid cart subtotal is required" });
    }

    const uid = uidFromRequest(req);

    const applied = await firestore.runTransaction((tx) =>
      validateCouponForAmount(tx, uid, subtotal, code)
    );

    if (!applied) {
      return res.status(400).json({ message: GENERIC_COUPON_ERROR });
    }

    return res.json({ code: applied.code, discountAmount: applied.discountAmount });
  } catch (_error) {
    // validateCouponForAmount throws human-readable reasons (expired, min-order,
    // usage limit, etc.). Do NOT expose the reason here — it lets attackers
    // enumerate valid codes by distinguishing "unknown" from "expired". The
    // per-user cap is still enforced authoritatively at order-create time.
    return res.status(400).json({ message: GENERIC_COUPON_ERROR });
  }
};
