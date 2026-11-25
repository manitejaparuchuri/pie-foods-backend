import crypto from "crypto";

export function normalizeCrmPhone(input: unknown): string {
  const digits = String(input || "").replace(/[^0-9]/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(1)}`;
  return /^\d{6,15}$/.test(digits) ? digits : "";
}

export function classifyRazorpay(order: any, payments: any, expectedPaise: number): "paid" | "unpaid" | "processing" {
  if (!order || Number(order.amount) !== expectedPaise || order.currency !== "INR" || !Array.isArray(payments?.items) || Number(payments.count) !== payments.items.length) return "processing";
  const rows = payments.items;
  if (rows.some((p: any) => p.order_id !== order.id || Number(p.amount) !== expectedPaise || p.currency !== "INR")) return "processing";
  if (rows.some((p: any) => p.status === "captured") && order.status === "paid" && Number(order.amount_paid) === expectedPaise) return "paid";
  if (order.status === "paid" || Number(order.amount_paid) > 0 || rows.some((p: any) => !["failed", "created"].includes(p.status))) return "processing";
  return ["created", "attempted"].includes(order.status) ? "unpaid" : "processing";
}

export function signRecovery(orderId: string, expires: number, secret: string): string {
  const body = Buffer.from(JSON.stringify({ id: orderId, exp: expires })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function readRecovery(token: string, secret: string, now = Date.now()): string | null {
  if (!secret || token.length > 1024) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature) || extra) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof value.id === "string" && /^[A-Za-z0-9_-]{1,150}$/.test(value.id) && Number.isFinite(value.exp) && value.exp > now ? value.id : null;
  } catch { return null; }
}
