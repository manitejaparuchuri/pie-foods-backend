import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createOrder, getMyOrders, getOrderById } from '../controller/order.controller';
import { trackOrder } from '../controller/delhivery.controller';
import {
  createGuestOrderController,
  getGuestOrderController,
} from '../controller/guest-order.controller';
import { verifyToken } from '../middlewares/auth';

const router = Router();

// Guest endpoints — no auth, but rate-limited by IP as a circuit breaker.
// Per-email limits are enforced inside createGuestOrderController via Firestore
// counters; this IP limiter is the outer guardrail against runaway bots.
const guestOrderIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100,                  // generous so legit traffic is never blocked
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests from this network. Try again later.' },
});

const guestOrderReadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 600, // reads (track/view) are cheap; allow plenty
  standardHeaders: true,
  legacyHeaders: false,
});

// Guest order creation + read by token. Must come BEFORE /:id so "guest" segment
// isn't captured as an order id.
router.post('/guest', guestOrderIpLimiter, createGuestOrderController);
router.get('/guest/:id', guestOrderReadLimiter, getGuestOrderController);

router.post('/', verifyToken, createOrder);
router.get('/my', verifyToken, getMyOrders);
// Order tracking — pulls live status from Delhivery when waybill exists.
// Keep BEFORE /:id so the literal "track" segment is not captured as an id.
router.get('/:id/track', verifyToken, trackOrder);
// Single-order fetch — owner-only (admins always allowed). Keep AFTER /my so
// the literal route wins over the :id param.
router.get('/:id', verifyToken, getOrderById);

export default router;
