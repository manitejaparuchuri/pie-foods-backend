import { loadEnv, makeClients } from "./_imgkit.mjs";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

const env = loadEnv();
const { r2, db } = await makeClients(env);

console.log("=== R2 BUCKET:", env.R2_BUCKET_NAME, "===");
let token = undefined;
const keys = [];
do {
  const out = await r2.send(
    new ListObjectsV2Command({
      Bucket: env.R2_BUCKET_NAME,
      ContinuationToken: token,
      MaxKeys: 1000,
    })
  );
  (out.Contents || []).forEach((o) => keys.push(`${o.Key}\t${o.Size}`));
  token = out.IsTruncated ? out.NextContinuationToken : undefined;
} while (token);
keys.sort();
keys.forEach((k) => console.log(k));
console.log(`(${keys.length} objects)\n`);

console.log("=== FIRESTORE banners ===");
const bSnap = await db.collection(env.FIREBASE_BANNERS_COLLECTION || "banners").get();
bSnap.forEach((d) => {
  const x = d.data();
  console.log(`doc=${d.id} banner_id=${x.banner_id} sort=${x.sort_order}`);
  console.log(`   image_url        = ${x.image_url}`);
  console.log(`   mobile_image_url = ${x.mobile_image_url ?? x.image_url_mobile ?? "(none)"}`);
});

console.log("\n=== FIRESTORE popular_products/main ===");
const pDoc = await db.collection("popular_products").doc("main").get();
if (pDoc.exists) {
  const x = pDoc.data();
  console.log(`title=${x.title} section_id=${x.section_id}`);
  (x.items || []).forEach((it) =>
    console.log(`   item_id=${it.item_id} name="${it.name}" image_url=${it.image_url}`)
  );
} else {
  console.log("popular_products/main does NOT exist (frontend uses backend defaults).");
}

process.exit(0);
