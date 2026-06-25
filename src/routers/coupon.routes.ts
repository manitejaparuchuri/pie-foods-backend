import { Router } from "express";
import { validateCoupon } from "../controller/coupon.controller";

const router = Router();

// Public coupon preview (optionally authenticated — uid is read from the token
// when present). Lets the storefront show the discounted total before checkout.
router.post("/validate", validateCoupon);

export default router;
