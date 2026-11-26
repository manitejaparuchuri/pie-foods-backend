import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { firestore } from "../config/firebase";
import { readRecovery } from "../services/crm-sync-policy";
import { recordCrmPaymentActivity } from "../services/crm-sync.service";
import { createGuestPaymentOrder, verifyGuestPayment } from "../controller/guest-payment.controller";
import { createPaymentOrder, verifyPayment } from "../controller/payment.controller";
import { AuthRequest } from "../middlewares/auth";

const router = Router();
router.use(rateLimit({ windowMs: 60000, max: 20, standardHeaders: true, legacyHeaders: false }));
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); next(); });

async function load(req: Request) {
  if (process.env.CRM_SYNC_ENABLED !== "true") throw new Error("unavailable");
  const token = String(req.body?.token || req.query.token || "");
  const id = readRecovery(token, process.env.CRM_RECOVERY_SIGNING_SECRET || "");
  if (!id) throw new Error("unavailable");
  const snapshot = await firestore.collection("orders").doc(id).get();
  const data = snapshot.data();
  if (!data || data.status !== "PENDING_PAYMENT" || data.payment_method !== "RAZORPAY") throw new Error("unavailable");
  return { id, data };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const { id, data } = await load(req);
    // orderNumber is the customer-facing PF… number; orderId (internal) is only used for navigation after payment
    return res.json({ orderId: id, orderNumber: data.order_number ? String(data.order_number) : null, currency: "INR", totalAmount: data.total_amount, items: (data.items || []).map((item: any) => ({ productId: item.product_id, name: item.name, quantity: item.quantity, price: item.price })) });
  } catch { return res.status(404).json({ message: "Recovery link is unavailable or expired" }); }
});

router.post("/activity", async (req: Request, res: Response) => {
  try { const { id } = await load(req); await recordCrmPaymentActivity(id); return res.json({ ok: true }); }
  catch { return res.status(404).json({ message: "Recovery link is unavailable or expired" }); }
});

for (const operation of ["payment", "verify"] as const) router.post(`/${operation}`, async (req: AuthRequest, res: Response) => {
  try {
    const { id, data } = await load(req);
    // Only the order selected by the signed capability may be paid; never trust body order/user IDs.
    req.body = { order_id: id, orderId: id, razorpay_order_id: req.body?.razorpay_order_id, razorpay_payment_id: req.body?.razorpay_payment_id, razorpay_signature: req.body?.razorpay_signature };
    if (data.is_guest) {
      req.body.guestAccessToken = data.guest_access_token;
      if (operation === "verify") {
        // After a verified payment, return the guest access token like the normal guest checkout does,
        // so the customer can open their order confirmation page.
        const send = res.json.bind(res);
        res.json = ((body: any) => send(res.statusCode < 400 && body?.order_id ? { ...body, guest_access_token: data.guest_access_token } : body)) as Response["json"];
      }
      return operation === "payment" ? createGuestPaymentOrder(req, res) : verifyGuestPayment(req, res);
    }
    req.user = { uid: String(data.user_id) } as AuthRequest["user"];
    return operation === "payment" ? createPaymentOrder(req, res) : verifyPayment(req, res);
  } catch { return res.status(404).json({ message: "Recovery link is unavailable or expired" }); }
});

export default router;
