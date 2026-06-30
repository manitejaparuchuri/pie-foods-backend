/**
 * Migrate order line-item image snapshots from products/<X>.png -> .webp,
 * but ONLY where products/<X>.webp actually exists in R2. Deep-transforms each
 * order doc (any nested string), writes back only the top-level fields that changed.
 * Financial fields are never touched (they don't match the URL pattern).
 */
import { loadEnv, makeClients } from "./_imgkit.mjs";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

const env = loadEnv();
const { r2, db } = await makeClients(env);

/* existing webp keys under products/ */
const webp = new Set();
let token;
do {
  const out = await r2.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME, Prefix: "products/", ContinuationToken: token, MaxKeys: 1000 }));
  for (const o of out.Contents || []) if (/\.webp$/i.test(o.Key)) webp.add(o.Key);
  token = out.IsTruncated ? out.NextContinuationToken : undefined;
} while (token);

// Match /products/<stem>.png on ANY host (media.piefoods.com OR pub-*.r2.dev, etc).
// [^/?#]+ for the stem means /products/admin/<x>.png (has a slash) is never matched.
const RE = /^(https?:\/\/[^/]+\/products\/)([^/?#]+)\.png((?:[?#]).*)?$/i;
function swap(s) {
  const m = s.match(RE);
  if (!m) return s;
  if (!webp.has(`products/${m[2]}.webp`)) return s; // no webp -> leave as png
  return `${m[1]}${m[2]}.webp${m[3] || ""}`;
}
function tx(v) {
  if (typeof v === "string") return swap(v);
  if (Array.isArray(v)) return v.map(tx);
  if (v && typeof v === "object") { const o = {}; for (const [k, val] of Object.entries(v)) o[k] = tx(val); return o; }
  return v;
}

const snap = await db.collection("orders").get();
let changedOrders = 0, changedFields = 0;
for (const doc of snap.docs) {
  const data = doc.data();
  const next = tx(data);
  const upd = {};
  for (const k of Object.keys(data)) {
    if (JSON.stringify(data[k]) !== JSON.stringify(next[k])) { upd[k] = next[k]; changedFields++; }
  }
  if (Object.keys(upd).length) {
    await doc.ref.update(upd);
    changedOrders++;
    console.log(`  ✅ order ${doc.id} (${doc.data().order_number || ""}) — fields: ${Object.keys(upd).join(", ")}`);
  }
}
console.log(`\nMigrated ${changedOrders} orders (${changedFields} field(s) rewritten).`);
process.exit(0);
