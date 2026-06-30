/**
 * Replace banner + popular-product images with the new lightweight webp set.
 *
 * - Desktop banners  -> R2 banners/website-banner-{1,2,3}.webp  + Firestore banners.image_url
 * - Mobile banners   -> R2 banners/mobile-banner-{1,2,3}.webp   + Firestore banners.mobile_image_url
 * - Popular products -> R2 products/popular/<slug>.webp          + Firestore popular_products/main items[].image_url
 *
 * New filenames are used (not overwrite) to bust the 1-year immutable CDN cache.
 * Public URLs use https://media.piefoods.com to match the existing live records.
 */
import { loadEnv, makeClients } from "./_imgkit.mjs";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "fs/promises";

const SRC = String(process.env.WEBP_DIR || "").trim();
if (!SRC) {
  console.error("Set WEBP_DIR to the extracted Webp/ folder.");
  process.exit(1);
}

const CDN = "https://media.piefoods.com";
const env = loadEnv();
const { r2, db } = await makeClients(env);

async function put(localFile, key) {
  const body = await readFile(localFile);
  await r2.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  const url = `${CDN}/${key}`;
  console.log(`  ☁️  ${key}  (${body.length} bytes)`);
  return url;
}

/* ───────── Banners: doc banner-{id}, desktop=image_url, mobile=mobile_image_url ───────── */
const BANNERS = [
  { id: 1, desktop: "Desktop/Website banner 1.webp", mobile: "Mobile/1080x1920 Banner 1.webp" },
  { id: 2, desktop: "Desktop/Website banner 2.webp", mobile: "Mobile/1080x1920 Banner 2.webp" },
  { id: 3, desktop: "Desktop/Website banner 3.webp", mobile: "Mobile/1080x1920 Banner 3.webp" },
];

console.log("\n=== BANNERS ===");
for (const b of BANNERS) {
  console.log(`banner-${b.id}:`);
  const imageUrl = await put(`${SRC}/${b.desktop}`, `banners/website-banner-${b.id}.webp`);
  const mobileUrl = await put(`${SRC}/${b.mobile}`, `banners/mobile-banner-${b.id}.webp`);
  await db.collection(env.FIREBASE_BANNERS_COLLECTION || "banners").doc(`banner-${b.id}`).update({
    image_url: imageUrl,
    mobile_image_url: mobileUrl,
  });
  console.log(`  ✅ Firestore banner-${b.id} -> image_url + mobile_image_url updated`);
}

/* ───────── Popular products: popular_products/main items[] matched by item_id ───────── */
const POPULAR = [
  { itemId: 11, file: "popular products/Monk fruit sugar.webp", slug: "monk-fruit-sweetener" },
  { itemId: 12, file: "popular products/monk fruit drops.webp", slug: "monk-fruit-sweetener-drops" },
  { itemId: 8,  file: "popular products/Banana Chips.webp",     slug: "banana-pie-chips" },
  { itemId: 9,  file: "popular products/Mango Bites.webp",      slug: "mango-pie-chips" },
  { itemId: 10, file: "popular products/Jamun Bites.webp",      slug: "jamun-pie-chips" },
];

console.log("\n=== POPULAR PRODUCTS ===");
const docRef = db.collection("popular_products").doc("main");
const snap = await docRef.get();
if (!snap.exists) {
  console.error("popular_products/main missing — aborting popular update.");
  process.exit(1);
}
const data = snap.data();
const items = Array.isArray(data.items) ? data.items.map((i) => ({ ...i })) : [];

for (const p of POPULAR) {
  const url = await put(`${SRC}/${p.file}`, `products/popular/${p.slug}.webp`);
  const item = items.find((i) => Number(i.item_id) === p.itemId);
  if (!item) {
    console.warn(`  ⚠️  item_id=${p.itemId} not found in popular_products/main — skipped Firestore.`);
    continue;
  }
  item.image_url = url;
  console.log(`  ✅ item_id=${p.itemId} "${item.name}" -> ${url}`);
}
await docRef.update({ items });
console.log("  ✅ popular_products/main items[] written back");

console.log("\n🎉 All images replaced. Backend caches banners/popular for 5 min; allow a short delay.");
process.exit(0);
