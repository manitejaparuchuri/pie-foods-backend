/**
 * Re-point each banner doc to the correct image per slide CONTENT (files already in R2).
 *   banner-1 "Sweetness, Better Than Sugar" -> website-banner-2 / mobile-banner-2
 *   banner-2 "A Drop of Pure Sweetness"     -> website-banner-3 / mobile-banner-1
 *   banner-3 "Real Fruit. Nothing Else."    -> website-banner-1 / mobile-banner-3
 */
import { loadEnv, makeClients } from "./_imgkit.mjs";
const CDN = "https://media.piefoods.com";
const env = loadEnv();
const { db } = await makeClients(env);
const col = env.FIREBASE_BANNERS_COLLECTION || "banners";

const MAP = [
  { doc: "banner-1", desktop: "website-banner-2", mobile: "mobile-banner-2" },
  { doc: "banner-2", desktop: "website-banner-3", mobile: "mobile-banner-1" },
  { doc: "banner-3", desktop: "website-banner-1", mobile: "mobile-banner-3" },
];

for (const m of MAP) {
  const image_url = `${CDN}/banners/${m.desktop}.webp`;
  const mobile_image_url = `${CDN}/banners/${m.mobile}.webp`;
  await db.collection(col).doc(m.doc).update({ image_url, mobile_image_url });
  console.log(`✅ ${m.doc}`);
  console.log(`     image_url        = ${image_url}`);
  console.log(`     mobile_image_url = ${mobile_image_url}`);
}
console.log("\nDone. Backend caches banners ~5 min.");
process.exit(0);
