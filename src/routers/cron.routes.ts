import { Router } from "express";
import { pollTrackingCron } from "../controller/cron.controller";

const router = Router();

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
