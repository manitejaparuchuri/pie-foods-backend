import express from "express";
import rateLimit from "express-rate-limit";
import { getMe, googleLogin, login, updateMe } from "../controller/login.controller";
import { register } from "../controller/register.controller";
import { requestOtpController, verifyOtpController } from "../controller/otp-login.controller";
import { verifyToken } from "../middlewares/auth";

const router = express.Router();

router.post("/login", login);
router.post("/register", register);
router.post("/google", googleLogin);

// OTP login — IP-level circuit breaker on top of the per-email limits
// already enforced inside requestOtp() (max 3 sends per email per 10 min).
const otpRequestIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many OTP requests from this network. Try again later." },
});

const otpVerifyIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/otp/request", otpRequestIpLimiter, requestOtpController);
router.post("/otp/verify", otpVerifyIpLimiter, verifyOtpController);

// Authenticated profile read/update for the signed-in user.
router.get("/me", verifyToken, getMe);
router.put("/me", verifyToken, updateMe);

export default router;
