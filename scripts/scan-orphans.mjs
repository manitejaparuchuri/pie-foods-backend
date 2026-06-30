/**
 * Find orphaned top-level products/<name>.png objects in R2.
 * Candidate = key matching ^products/[^/]+\.png$  (excludes products/admin/* and products/thumbs/*).
 * Orphan    = NO Firestore document (ANY collection, deep-scanned) references it
 *             by full key OR by bare filename.
 * Also reports R2 bucket versioning status (recoverability).
 */
import { loadEnv, makeClients } from "./_imgkit.mjs";
import { ListObjectsV2Command, GetBucketVersioningCommand } from "@aws-sdk/client-s3";

const env = loadEnv();
const { r2, db } = await makeClients(env);

/* 1. Candidate PNGs (top-level products/, not admin/thumbs) */
let token, candidates = [];
do {
  const out = await r2.send(new ListObjectsV2Command({
    Bucket: env.R2_BUCKET_NAME, Prefix: "products/", ContinuationToken: token, MaxKeys: 1000,
  }));
  for (const o of out.Contents || []) {
    if (/^products\/[^/]+\.png$/i.test(o.Key)) candidates.push({ key: o.Key, size: o.Size });
  }
  token = out.IsTruncated ? out.NextContinuationToken : undefined;
} while (token);
candidates.sort((a, b) => a.key.localeCompare(b.key));

const filenameOf = (k) => k.split("/").pop();

/* 2. Deep-scan EVERY collection's EVERY doc */
const cols = await db.listCollections();
console.log("Collections:", cols.map((c) => c.id).join(", "), "\n");

const refs = new Map(); // key -> [ "collection/doc#field-ish" ... ]
for (const c of candidates) refs.set(c.key, []);

let totalDocs = 0;
for (const col of cols) {
  const snap = await col.get();
  for (const doc of snap.docs) {
    totalDocs++;
    const blob = JSON.stringify(doc.data() || {});
    for (const c of candidates) {
      const fname = filenameOf(c.key);
      // match full key OR bare filename (covers relative paths / encoded spaces)
      if (blob.includes(c.key) || blob.includes(fname)) {
        refs.get(c.key).push(`${col.id}/${doc.id}`);
      }
    }
  }
}
console.log(`Scanned ${totalDocs} docs across ${cols.length} collections.\n`);

/* 3. Bucket versioning (recoverability) */
let versioning = "Unknown";
try {
  const v = await r2.send(new GetBucketVersioningCommand({ Bucket: env.R2_BUCKET_NAME }));
  versioning = v.Status || "Disabled/Unset";
} catch (e) {
  versioning = `error: ${e.name}`;
}

/* 4. Report */
const orphans = [], referenced = [];
for (const c of candidates) {
  const r = refs.get(c.key);
  (r.length ? referenced : orphans).push({ ...c, refs: r });
}

console.log("=== REFERENCED (DO NOT DELETE) ===");
if (!referenced.length) console.log("  (none)");
referenced.forEach((c) => console.log(`  ${c.key}  <- ${[...new Set(c.refs)].join(", ")}`));

console.log("\n=== ORPHANS (safe to delete) ===");
let bytes = 0;
orphans.forEach((c) => { bytes += c.size; console.log(`  ${c.key}  (${(c.size/1048576).toFixed(2)} MB)`); });
console.log(`\n  ${orphans.length} orphans, ${(bytes/1048576).toFixed(2)} MB total`);
console.log(`  Candidates: ${candidates.length} | Referenced: ${referenced.length} | Orphans: ${orphans.length}`);
console.log(`\nBucket versioning: ${versioning}`);

// emit machine-readable list for the delete step
console.log("\nORPHAN_KEYS=" + orphans.map((c) => c.key).join("|"));
process.exit(0);
