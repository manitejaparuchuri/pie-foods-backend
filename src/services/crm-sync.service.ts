import crypto from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import getRazorpayClient from "../config/razorpay";
import { classifyRazorpay, normalizeCrmPhone, signRecovery } from "./crm-sync-policy";
import { localPaymentsEnabled } from "./local-payments.service";

const queue = firestore.collection("crm_checkout_sync");
export const crmSyncEnabled = () => process.env.CRM_SYNC_ENABLED === "true";

/** Add in the source transaction: a committed order/enquiry cannot lose its sync intent. */
export function writeCrmSync(tx: { set: (...args: any[]) => any }, kind: "order" | "lead" | "enquiry", id: string): void {
  if (!crmSyncEnabled()) return;
  const now = Timestamp.now();
  tx.set(queue.doc(`${kind}-${id}`), { kind, source_id: id, activity_at: now, next_at: now, closed: false, revision: FieldValue.increment(1) }, { merge: true });
}

export type CrmEnquiryType = "registration" | "contact_form" | "newsletter";
const enquiries = firestore.collection("crm_enquiries");

/**
 * Website registration, contact form and newsletter sign-ups become CRM leads (requirement §15.1).
 * The record and its sync intent commit together; delivery to the CRM happens in the background worker.
 * Server-only collection: never allow browser reads or writes to crm_enquiries.
 */
export async function recordCrmEnquiry(type: CrmEnquiryType, input: { name?: string; email?: string; phone?: string; subject?: string; message?: string; user_id?: string; referral_code?: string }): Promise<void> {
  if (!crmSyncEnabled()) return;
  try {
    const ref = enquiries.doc();
    const email = String(input.email || "").trim().toLowerCase().slice(0, 200);
    const record = {
      type,
      name: String(input.name || "").trim().slice(0, 200),
      email,
      phone: String(input.phone || "").trim().slice(0, 30),
      subject: String(input.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200),
      message: String(input.message || "").trim().slice(0, 4000),
      user_id: input.user_id ? String(input.user_id) : null,
      // A shared referral code (?ref=) if the shopper arrived through one; the CRM validates and links it
      referral_code: /^[A-Za-z0-9]{4,20}$/.test(String(input.referral_code || "")) ? String(input.referral_code).toUpperCase() : null,
      created_at: Timestamp.now(),
    };
    const batch = firestore.batch();
    batch.set(ref, record);
    writeCrmSync(batch, "enquiry", ref.id);
    await batch.commit();
  } catch {
    // Never fail the shopper's sign-up or message because the CRM intent could not be written
    console.error("[crm-sync] enquiry intent not recorded", type);
  }
}

/** Only called after the existing authenticated/token-authorized payment-create path. */
export async function recordCrmPaymentActivity(id: string): Promise<void> {
  if (!crmSyncEnabled()) return;
  try { const batch = firestore.batch(); writeCrmSync(batch, "order", id); await batch.commit(); }
  catch { console.error("[crm-sync] payment activity pending; existing durable order sync retained"); }
}

export async function wakeCrmPaymentSync(id: string): Promise<void> {
  if (!crmSyncEnabled()) return;
  try {
    const ref = queue.doc(`order-${id}`);
    await firestore.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) tx.update(ref, { closed: false, next_at: Timestamp.now() });
      // No backfill of historical orders which predate enabling integration.
    });
  } catch { console.error("[crm-sync] paid-order wake deferred; queued sync retained"); }
}

async function crm(path: string, body: Record<string, unknown>): Promise<any> {
  const base = String(process.env.CRM_API_BASE_URL || "").replace(/\/$/, "");
  const key = process.env.CRM_API_KEY || "";
  const url = new URL(base);
  if (!key || (url.protocol !== "https:" && !(process.env.FIRESTORE_EMULATOR_HOST && url.protocol === "http:"))) throw new Error("CRM configuration invalid");
  // Do not follow redirects with an integration credential.
  const response = await fetch(`${base}/crm/lifecycle/${path}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", "X-API-Key": key }, body: JSON.stringify(body) });
  const result = await response.json() as any;
  // The CRM's own reason (no customer data) so a stuck sync is diagnosable from the log
  if (!response.ok || !result.success) throw new Error(`CRM HTTP ${response.status}: ${String(result?.message || "no message").slice(0, 200)}`);
  return result.data;
}

function iso(value: any): string { return value?.toDate?.().toISOString() || new Date().toISOString(); }

async function boundedProviderRead<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Provider read timeout")), 10000); })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function customer(data: any): Promise<Record<string, unknown>> {
  const uid = String(data.user_id || "");
  const user = uid ? (await firestore.collection("users").doc(uid).get()).data() || {} : {};
  const address = uid && data.shipping_id ? (await firestore.collection("users").doc(uid).collection("addresses").doc(String(data.shipping_id)).get()).data() || {} : data.shipping_address || {};
  const phone = normalizeCrmPhone(data.customer_phone || data.phone || address.phone || user.phone || user.phone_number);
  const email = String(data.customer_email || data.email || user.email || "").trim().toLowerCase();
  if (!phone && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Customer identity missing");
  return { name: String(data.customer_name || data.name || address.name || user.name || "Website customer").slice(0, 200), ...(phone ? { phone } : {}), ...(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email } : {}), location: String(address.city || data.city || "").slice(0, 200), source: "WEBSITE" };
}

/** Persist the exact next request BEFORE delivery; timeout retries use the same sequence/payload. */
async function event(ref: FirebaseFirestore.DocumentReference, state: any, body: Record<string, unknown>, ack: Record<string, unknown> = {}): Promise<void> {
  if (!state.pending_event) {
    state.sequence = Number(state.sequence || 0) + 1;
    state.pending_event = { ...body, sequence: state.sequence };
    state.pending_ack = ack;
    await ref.update({ sequence: state.sequence, pending_event: state.pending_event, pending_ack: ack });
  }
  await crm("checkouts/events", state.pending_event);
  Object.assign(state, state.pending_ack || {});
  state.pending_event = null;
  await ref.update({ ...(state.pending_ack || {}), pending_event: FieldValue.delete(), pending_ack: FieldValue.delete() });
}

const ENQUIRY_NAMES: Record<string, string> = { registration: "Website customer", contact_form: "Website enquiry", newsletter: "Newsletter subscriber" };

async function syncEnquiry(ref: FirebaseFirestore.DocumentReference, state: any): Promise<void> {
  const doc = await enquiries.doc(state.source_id).get();
  if (!doc.exists) { await ref.update({ closed: true }); return; }
  const data: any = doc.data();
  const phone = normalizeCrmPhone(data.phone);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email || "")) ? String(data.email) : "";
  // Nothing to identify the person by: keep the record, but there is no CRM profile to create
  if (!phone && !email) { await ref.update({ closed: true, skipped: "no_identity" }); return; }
  const captured = await crm("capture", {
    name: String(data.name || "").trim() || ENQUIRY_NAMES[data.type] || "Website enquiry",
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    source: "WEBSITE",
    enquiry: { type: data.type, subject: data.subject || "", message: data.message || "" },
    ...(data.referral_code ? { referral_code: data.referral_code } : {}),
  });
  await ref.update({ closed: true, contact_id: captured?.contact_id || null, synced_at: Timestamp.now() });
}

async function syncOne(ref: FirebaseFirestore.DocumentReference, state: any): Promise<number | void> {
  if (state.kind === "enquiry") return syncEnquiry(ref, state);
  const source = await firestore.collection(state.kind === "lead" ? "abandoned_checkouts" : "orders").doc(state.source_id).get();
  if (!source.exists) { await ref.update({ closed: true }); return; }
  const data: any = source.data();
  const captured = state.contact_id ? { contact_id: state.contact_id } : await crm("capture", await customer(data));
  if (!state.contact_id) { state.contact_id = captured.contact_id; await ref.update({ contact_id: captured.contact_id }); }
  // Public enquiry data can generate a lead, but cannot assert payment, consent or a recoverable order.
  if (state.kind === "lead") {
    await ref.update({ closed: true, synced_at: Timestamp.now() }); return;
  }
  const common = { source: "website", reference: String(state.source_id), contact_id: state.contact_id };
  if (state.pending_event?.event === "payment_status" && Date.now() - Date.parse(state.pending_event.checked_at) > 10 * 60000) {
    state.pending_event = null;
    await ref.update({ pending_event: FieldValue.delete(), pending_ack: FieldValue.delete() });
  }
  const expired = state.expires && state.expires <= Date.now();
  if (expired && state.pending_event) {
    state.pending_event = null;
    await ref.update({ pending_event: FieldValue.delete(), pending_ack: FieldValue.delete() });
  }
  if (state.pending_event) await event(ref, state, {});
  if (data.payment_method === "COD") return syncCodOrder(ref, state, data);
  if (!["PENDING_PAYMENT", "PAID"].includes(String(data.status))) {
    if (state.activity_revision) await event(ref, state, { ...common, event: "cancel" });
    await ref.update({ closed: true }); return;
  }
  const { items, total } = orderLines(data);
  if (!expired && Number(state.activity_revision || 0) !== Number(state.revision)) {
    const expires = Number(state.expires || Date.now() + 24 * 3600000);
    const secret = process.env.CRM_RECOVERY_SIGNING_SECRET || "";
    const link = new URL(process.env.CRM_CHECKOUT_URL || "");
    const localLink = localPaymentsEnabled() && link.origin === "http://localhost:4200";
    if (secret.length < 32 || (link.protocol !== "https:" && !localLink)) throw new Error("Recovery configuration missing");
    link.searchParams.set("recovery", signRecovery(state.source_id, expires, secret));
    await event(ref, state, { ...common, event: "activity", order_reference: state.source_id, stage: data.provider_order_id ? "payment" : "checkout", occurred_at: iso(state.activity_at), expires_at: new Date(expires).toISOString(), recovery_url: link.href, currency: "INR", total_price: total, items }, { activity_revision: state.revision, expires });
  }
  // A PAID browser callback can mean authorized rather than captured in legacy paths.
  // Always fetch Razorpay, including payment attempts, before exporting paid or unpaid.
  let status: "paid" | "unpaid" | "processing" = "processing";
  let capturedAt: string | undefined;
  if (data.provider_order_id) {
    try {
      const client = getRazorpayClient();
      const [order, payments] = await boundedProviderRead(Promise.all([client.orders.fetch(String(data.provider_order_id)), client.orders.fetchPayments(String(data.provider_order_id))]));
      status = classifyRazorpay(order, payments, Math.round(total * 100));
      if (status === "paid") {
        const payment = (payments as any).items.find((p: any) => p.status === "captured");
        if (payment?.created_at) capturedAt = new Date(Number(payment.created_at) * 1000).toISOString();
      }
      if (data.status === "PAID" && status === "unpaid") status = "processing";
    } catch { status = "processing"; }
  }
  if (status === "paid") {
    await crm("orders", { source: "website", reference: state.source_id, contact_id: state.contact_id, payment_status: "paid", currency: "INR", total_price: total, items, ...(capturedAt ? { purchased_at: capturedAt } : {}) });
    await ref.update({ closed: true, synced_at: Timestamp.now() });
  } else {
    if (expired) { await ref.update({ closed: true }); return; }
    await event(ref, state, { ...common, event: "payment_status", payment_status: status, checked_at: new Date().toISOString() });
    // An unpaid checkout stays open until it is paid or its link expires (24h). Re-check every minute for the
    // first 15 minutes, then every 15 minutes: a payment wakes the row immediately anyway, and polling each
    // minute for a day would cost ~1,400 Razorpay calls and several thousand Firestore writes per abandoned order.
    const age = Date.now() - (state.activity_at?.toMillis?.() || Date.now());
    return localPaymentsEnabled() || age < 15 * 60000 ? undefined : 15 * 60000;
  }
}

function orderLines(data: any): { items: Array<{ sku: string; name: string; quantity: number; price: number }>; total: number } {
  const items = (data.items || []).map((item: any) => ({ sku: String(item.sku || item.product_id), name: String(item.name || "Product"), quantity: Number(item.quantity), price: Number(item.price) }));
  const total = Number(data.total_amount);
  if (!items.length || !Number.isFinite(total) || total <= 0) throw new Error("Invalid authoritative order");
  return { items, total };
}

const COD_OPEN_STATUSES = ["PROCESSING", "SHIPPED", "OUT_FOR_DELIVERY"];

/**
 * COD orders go to the CRM as real orders: "unpaid" when placed, "paid" once delivered (cash collected).
 * "paid" triggers the CRM's purchase actions (referral credit etc.), so it must wait for delivery; a
 * cancelled or returned COD order is never marked paid. The row closes after each step and is re-opened
 * by the DELIVERED transition (admin status update or tracking poll), so nothing polls while in transit.
 */
async function syncCodOrder(ref: FirebaseFirestore.DocumentReference, state: any, data: any): Promise<void> {
  const status = String(data.status || "");
  if (state.cod_status === "paid") { await ref.update({ closed: true }); return; }
  const { items, total } = orderLines(data);
  const base = { source: "website", reference: String(state.source_id), contact_id: state.contact_id, currency: "INR", total_price: total, items };
  if (status === "DELIVERED") {
    const deliveredAt: Date | undefined = data.delivered_at?.toDate?.();
    await crm("orders", { ...base, payment_status: "paid", ...(deliveredAt ? { purchased_at: deliveredAt.toISOString() } : {}) });
    await ref.update({ closed: true, cod_status: "paid", synced_at: Timestamp.now() });
    return;
  }
  if (COD_OPEN_STATUSES.includes(status) && state.cod_status !== "unpaid") {
    await crm("orders", { ...base, payment_status: "unpaid" });
    await ref.update({ closed: true, cod_status: "unpaid", synced_at: Timestamp.now() });
    return;
  }
  await ref.update({ closed: true });
}

let running = false;
export async function runCrmSync(): Promise<{ enabled: boolean; scanned: number; synced: number; deferred: number }> {
  const result = { enabled: crmSyncEnabled(), scanned: 0, synced: 0, deferred: 0 };
  if (!crmSyncEnabled() || running) return result;
  running = true;
  try {
    const rows = await queue.where("closed", "==", false).where("next_at", "<=", Timestamp.now()).orderBy("next_at").limit(50).get();
    result.scanned = rows.size;
    for (const row of rows.docs) {
      const token = crypto.randomUUID();
      const acquired = await firestore.runTransaction(async (tx) => {
        const fresh = (await tx.get(row.ref)).data();
        if (!fresh || fresh.closed || (fresh.lease_until?.toMillis?.() || 0) > Date.now()) return false;
        tx.update(row.ref, { lease_token: token, lease_until: Timestamp.fromMillis(Date.now() + 180000) });
        return true;
      });
      if (!acquired) continue;
      const failures = Number(row.data().failures || 0);
      let delay: number | void = undefined;
      let failed = false;
      try { delay = await syncOne(row.ref, (await row.ref.get()).data()); result.synced++; }
      catch (error) { failed = true; result.deferred++; console.error("[crm-sync] sync deferred; durable record retained", row.id, "-", (error as Error)?.message || "unknown"); }
      finally {
        const base = localPaymentsEnabled() ? 3000 : 60000;
        // Repeated failures (CRM down, bad config, order without phone/email) back off 1, 2, 4… minutes up to 6 hours
        const wait = failed ? Math.min(base * 2 ** Math.min(failures, 9), 6 * 3600000) : (delay || base);
        await firestore.runTransaction(async (tx) => {
          const fresh = (await tx.get(row.ref)).data();
          if (fresh?.lease_token === token) tx.update(row.ref, { lease_until: Timestamp.fromMillis(0), next_at: Timestamp.fromMillis(Date.now() + wait), failures: failed ? failures + 1 : 0 });
        });
      }
    }
    return result;
  } finally { running = false; }
}

export function startCrmSync(): void {
  if (!crmSyncEnabled() || process.env.CRM_SYNC_SCHEDULER === "external") return;
  const tick = () => runCrmSync().catch(() => console.error("[crm-sync] worker unavailable; retained for retry"));
  const timer = setInterval(tick, localPaymentsEnabled() ? 3000 : 30000); timer.unref(); void tick();
}
