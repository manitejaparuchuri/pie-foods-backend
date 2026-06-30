/**
 * Delete the given R2 keys — but ONLY after re-verifying (deep scan of every
 * Firestore collection) that each key is referenced by ZERO documents.
 * Irreversible (bucket versioning is not accessible), so we re-check at delete time.
 *
 * Usage: KEYS="products/a.png|products/b.png" node scripts/delete-orphans.mjs
 */
import { loadEnv, makeClients } from "./_imgkit.mjs";
import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const env = loadEnv();
const { r2, db } = await makeClients(env);

const keys = String(process.env.KEYS || "").split("|").map((s) => s.trim()).filter(Boolean);
if (!keys.length) { console.error("No KEYS provided."); process.exit(1); }

// Build one blob of all docs to re-verify references
const cols = await db.listCollections();
const blobs = [];
for (const col of cols) {
  const snap = await col.get();
  for (const doc of snap.docs) blobs.push({ id: `${col.id}/${doc.id}`, s: JSON.stringify(doc.data() || {}) });
}
const fnameOf = (k) => k.split("/").pop();

const deleted = [], skipped = [];
for (const key of keys) {
  const fname = fnameOf(key);
  const hits = blobs.filter((b) => b.s.includes(key) || b.s.includes(fname)).map((b) => b.id);
  if (hits.length) {
    skipped.push({ key, hits });
    console.log(`  ⛔ SKIP ${key} — referenced by ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? " …" : ""}`);
    continue;
  }
  await r2.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
  // verify gone
  let gone = false;
  try { await r2.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key })); }
  catch (e) { gone = e.name === "NotFound" || e.$metadata?.httpStatusCode === 404; }
  console.log(`  ${gone ? "🗑️  DELETED" : "⚠️  delete-sent (verify failed)"} ${key}`);
  deleted.push(key);
}

console.log(`\nDeleted: ${deleted.length} | Skipped (referenced): ${skipped.length}`);
process.exit(0);
