import express from "express";
import rateLimit from "express-rate-limit";
import {
  createPaymentOrder,
  razorpayWebhook,
  verifyPayment
} from "../controller/payment.controller";
import {
  createGuestPaymentOrder,
  verifyGuestPayment,
} from "../controller/guest-payment.controller";
import { verifyToken } from "../middlewares/auth";

const router = express.Router();

// IP-based circuit breaker for guest payment endpoints. The token in the body
// is the real authenticator — this just blocks abusive bursts.
const guestPaymentIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/create-order", verifyToken, createPaymentOrder);
router.post("/verify", verifyToken, verifyPayment);
router.post("/guest/create-order", guestPaymentIpLimiter, createGuestPaymentOrder);
router.post("/guest/verify", guestPaymentIpLimiter, verifyGuestPayment);
router.post("/webhook", razorpayWebhook);

export default router;
