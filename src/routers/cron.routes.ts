import { Router } from "express";
import { pollTrackingCron } from "../controller/cron.controller";
import crypto from "crypto";
import { runCrmSync } from "../services/crm-sync.service";

const router = Router();

router.post("/sync-crm", async (req, res) => {
  const expected = String(process.env.CRON_SECRET || "");
  const supplied = String(req.headers["x-cron-secret"] || "");
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(401).json({ message: "Unauthorized" });
  try { const result = await runCrmSync(); return res.status(result.deferred ? 503 : 200).json({ ok: !result.deferred, ...result }); }
  catch { return res.status(503).json({ message: "CRM sync unavailable; retry later" }); }
});

/**
 * External scheduler hits this hourly to refresh tracking on every in-flight
 * order. Protected by `x-cron-secret` header (or `?secret=` query) compared
 * against `CRON_SECRET` env var.
 *
 * Accepts both POST and GET so simple cron services that only do GET work too.
 */
router.post("/poll-tracking", pollTrackingCron);
router.get("/poll-tracking", pollTrackingCron);

export default router;
