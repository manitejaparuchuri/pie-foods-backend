import { Router } from "express";
import { localPaymentsEnabled, simulatePayment } from "../services/local-payments.service";

const router = Router();
router.post("/complete", async (req, res) => {
  if (!localPaymentsEnabled()) return res.sendStatus(404);
  res.setHeader("Cache-Control", "no-store");
  try { return res.json(await simulatePayment(String(req.body.order_id || ""), String(req.body.outcome || ""))); }
  catch { return res.status(400).json({ message: "Local simulation unavailable or invalid" }); }
});
export default router;
