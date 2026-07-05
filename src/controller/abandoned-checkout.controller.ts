import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
  upsertCheckoutLead,
  markCheckoutLeadConverted,
  listAbandonedCheckouts,
} from "../services/abandoned-checkout.service";

/** Optional auth: derive the uid from a bearer token if present, else "". Never
 *  trust a client-supplied userId — a spoofed one would mislabel the lead. */
function uidFromRequest(req: Request): string {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return "";
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { uid?: string };
    return String(decoded?.uid || "");
  } catch {
    return "";
  }
}

/**
 * PUBLIC — POST /api/leads
 * Storefront upserts the shopper's in-progress checkout details. Best-effort:
 * a failure here must never disrupt the customer's checkout, so we still 200
 * on soft validation issues and only 400 on a genuinely bad request.
 */
export const saveCheckoutLead = async (req: Request, res: Response) => {
  try {
    // Authoritative uid comes from the token (if signed in), never the body.
    const uid = uidFromRequest(req);
    await upsertCheckoutLead({ ...(req.body || {}), userId: uid || null });
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(400).json({ ok: false, message: error?.message || "Could not save lead" });
  }
};

/**
 * PUBLIC — POST /api/leads/convert  { leadId, orderId? }
 * Marks the lead CONVERTED after a successful order. Always resolves ok — this
 * is fire-and-forget cleanup, never worth surfacing an error to the customer.
 */
export const convertCheckoutLead = async (req: Request, res: Response) => {
  try {
    await markCheckoutLeadConverted(String(req.body?.leadId || ""), String(req.body?.orderId || ""));
  } catch (error) {
    console.error("CONVERT LEAD ERROR:", error);
  }
  return res.json({ ok: true });
};

/**
 * ADMIN — GET /api/admin/abandoned-checkouts
 * Lists shoppers who entered details but never completed an order.
 */
export const getAbandonedCheckouts = async (_req: Request, res: Response) => {
  try {
    const leads = await listAbandonedCheckouts();
    return res.json({ leads });
  } catch (error) {
    console.error("GET ABANDONED CHECKOUTS ERROR:", error);
    return res.status(500).json({ message: "Failed to load abandoned checkouts" });
  }
};
