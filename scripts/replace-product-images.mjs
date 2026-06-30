/**
 * Replace product mockup images with the new lightweight webp set.
 *
 * 1. Upload every webp in WEBP_DIR to R2 as products/<basename>.webp (new key = cache bust).
 * 2. For each product doc, swap any image_url..image_url5 that points to
 *    https://media.piefoods.com/products/<X>.png  ->  .../products/<X>.webp
 *    but ONLY when <X>.webp was actually uploaded. (product-42's admin jpegs and
 *    any unreferenced file are left untouched.)
 *
 * Public URLs use https://media.piefoods.com to match existing records.
 */
import { loadEnv, makeClients } from "./_imgkit.mjs";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile, readdir } from "fs/promises";

const SRC = String(process.env.WEBP_DIR || "").trim();
if (!SRC) {
  console.error("Set WEBP_DIR to the extracted product-images folder.");
  process.exit(1);
}

const CDN = "https://media.piefoods.com";
const env = loadEnv();
const { r2, db } = await makeClients(env);

/* ───────── 1. Upload all webp -> products/<basename>.webp ───────── */
const files = (await readdir(SRC)).filter((f) => f.toLowerCase().endsWith(".webp"));
const uploadedStems = new Set(); // basename without extension, e.g. "Apple-Pie-chips-Mockup-1"
console.log(`=== UPLOAD (${files.length} webp -> R2 products/) ===`);
for (const f of files) {
  const stem = f.replace(/\.webp$/i, "");
  const key = `products/${stem}.webp`;
  const body = await readFile(`${SRC}/${f}`);
  await r2.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  uploadedStems.add(stem);
  console.log(`  ☁️  ${key}  (${body.length} bytes)`);
}

/* ───────── 2. Repoint Firestore product image fields ───────── */
const IMG_FIELDS = ["image_url", "image_url1", "image_url2", "image_url3", "image_url4", "image_url5"];
// matches https://media.piefoods.com/products/<stem>.png   (no /admin/, no /thumbs/)
const RE = /^https?:\/\/media\.piefoods\.com\/products\/([^/?#]+)\.png(\?.*)?$/i;

const col = env.FIREBASE_PRODUCTS_COLLECTION || "products";
const snap = await db.collection(col).get();
console.log(`\n=== REPOINT (${col}) ===`);

for (const doc of snap.docs) {
  const x = doc.data();
  const update = {};
  for (const field of IMG_FIELDS) {
    const val = x[field];
    if (typeof val !== "string") continue;
    const m = val.match(RE);
    if (!m) continue;
    const stem = m[1];
    if (!uploadedStems.has(stem)) {
      console.log(`  ⚠️  ${doc.id}.${field}: no webp uploaded for "${stem}" — left as PNG`);
      continue;
    }
    update[field] = `${CDN}/products/${stem}.webp`;
  }
  if (Object.keys(update).length) {
    await doc.ref.update(update);
    console.log(`  ✅ ${doc.id} "${x.name}"`);
    for (const [k, v] of Object.entries(update)) console.log(`        ${k} -> ${v}`);
  } else {
    console.log(`  •  ${doc.id} "${x.name}" — no png/products fields to swap (unchanged)`);
  }
}

console.log("\n🎉 Product images replaced. Backend caches products briefly; allow a short delay.");
process.exit(0);
