/**
 * Seed (or refresh) the new-user welcome coupon WELCOME10.
 *   - 10% off the product subtotal (PERCENT)
 *   - once per user (usage_limit_per_user: 1)
 *   - no minimum, no expiry, active
 * Doc ID = the (uppercase) coupon code, matching coupon.service.ts lookup.
 * Idempotent: re-running preserves used_count if the doc already exists.
 */
import { loadEnv, makeClients } from "./_imgkit.mjs";

const env = loadEnv();
const { admin, db } = await makeClients(env);
const { Timestamp } = admin.firestore;

const CODE = "WELCOME10";
const ref = db.collection("coupons").doc(CODE);
const snap = await ref.get();
const existing = snap.exists ? snap.data() : {};

const payload = {
  code: CODE,
  description: "New-user welcome offer — 10% off your first order",
  discount_type: "PERCENT",
  discount_value: 10,
  max_discount_amount: null,
  min_order_amount: 0,
  starts_at: null,
  expires_at: null,
  usage_limit_total: null,
  usage_limit_per_user: 1,
  used_count: Number(existing.used_count || 0),
  is_active: true,
  updated_at: Timestamp.now(),
  ...(snap.exists ? {} : { created_at: Timestamp.now() }),
};

await ref.set(payload, { merge: true });
console.log(`${snap.exists ? "Updated" : "Created"} coupons/${CODE}:`);
console.log(JSON.stringify({ ...payload, updated_at: "<ts>", created_at: snap.exists ? undefined : "<ts>" }, null, 2));
process.exit(0);
