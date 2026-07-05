import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  saveCheckoutLead,
  convertCheckoutLead,
} from "../controller/abandoned-checkout.controller";

/**
 * Public lead-capture endpoints (no auth — the shopper isn't necessarily
 * logged in). Mounted at /api/leads.
 *
 * The storefront debounces saves, so a real shopper makes only a handful of
 * calls per checkout. This IP limiter is the outer guardrail against a bot
 * spraying junk leads (the doc id is a client-supplied uuid, so writes are
 * otherwise unbounded). Generous enough to never block legit traffic.
 */
const leadIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests from this network. Try again later." },
});

const router = Router();

router.post("/", leadIpLimiter, saveCheckoutLead);
router.post("/convert", leadIpLimiter, convertCheckoutLead);

export default router;
