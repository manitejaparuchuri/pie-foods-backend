import express from "express";
import {
  createPaymentOrder,
  razorpayWebhook,
  verifyPayment
} from "../controller/payment.controller";
import { verifyToken } from "../middlewares/auth";

const router = express.Router();

router.post("/create-order", verifyToken, createPaymentOrder);
router.post("/verify", verifyToken, verifyPayment);
router.post("/webhook", razorpayWebhook);

export default router;
