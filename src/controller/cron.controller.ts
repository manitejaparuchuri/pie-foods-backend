import { Request, Response } from "express";
import crypto from "crypto";
import { pollInFlightOrders } from "../services/tracking-poll.service";

/* ===================================================================
   Cron Controller
   ===================================================================
   HTTP endpoints intended to be hit by an external scheduler
   (cron-job.org, GitHub Actions, Vercel Cron, Railway cron, etc.).

   Auth: a shared secret in either the `x-cron-secret` header or a
   `?secret=` query parameter. Compared in constant time. Set on Railway
   as `CRON_SECRET`.
   =================================================================== */

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAuthorized(req: Request): boolean {
  const expected = String(process.env.CRON_SECRET || "").trim();
  if (!expected) {
    // No secret configured → block by default.
    return false;
  }
  const provided = String(
    req.headers["x-cron-secret"] ||
      req.query.secret ||
      req.body?.secret ||
      ""
  ).trim();
  if (!provided) return false;
  return timingSafeStringEqual(expected, provided);
}

/**
 * POST /api/cron/poll-tracking
 *
 * For every in-flight order (status SHIPPED or OUT_FOR_DELIVERY) with a
 * waybill, refresh the Delhivery tracking, update the order doc, and fire
 * status-change emails (out-for-delivery / delivered).
 */
export const pollTrackingCron = async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const result = await pollInFlightOrders();
    return res.json({
      ok: true,
      scanned: result.scanned,
      updated: result.updated,
      outForDelivery: result.outForDelivery,
      delivered: result.delivered,
      errors: result.errors,
      details: result.details,
    });
  } catch (err: any) {
    console.error("POLL TRACKING CRON ERROR:", err);
    return res
      .status(500)
      .json({ ok: false, message: String(err?.message || err) });
  }
};
