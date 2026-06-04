/**
 * One-shot script to upload the 3 mobile-banner images to Cloudflare R2
 * and patch the corresponding Firestore banner documents with
 * `mobile_image_url`.
 *
 * Usage (from pie-foods-backend/):
 *   npx tsx scripts/upload-mobile-banners.ts
 */

import "dotenv/config";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import admin from "firebase-admin";

/* ───────────── ENV helpers ───────────── */
const env = (key: string) => String(process.env[key] || "").trim();

/* ───────────── R2 client ───────────── */
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  },
});
const R2_BUCKET = env("R2_BUCKET_NAME");
const R2_PUBLIC = env("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");

/* ───────────── Firebase Admin ───────────── */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env("FIREBASE_PROJECT_ID"),
      clientEmail: env("FIREBASE_CLIENT_EMAIL"),
      privateKey: env("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });
}
const db = admin.firestore();
const BANNERS_COLLECTION = env("FIREBASE_BANNERS_COLLECTION") || "banners";

/* ───────────── Mapping: banner_id → local file ───────────── */
const MOBILE_BANNERS: Array<{
  bannerId: number;
  localPath: string;
  objectKey: string;
}> = [
  {
    bannerId: 1,
    localPath: resolve(__dirname, "../../src/assets/images/mobile-banner-1.jpg"),
    objectKey: "banners/mobile-banner-1.jpg",
  },
  {
    bannerId: 2,
    localPath: resolve(__dirname, "../../src/assets/images/mobile-banner-2.jpg"),
    objectKey: "banners/mobile-banner-2.jpg",
  },
  {
    bannerId: 3,
    localPath: resolve(__dirname, "../../src/assets/images/mobile-banner-3.jpg"),
    objectKey: "banners/mobile-banner-3.jpg",
  },
];

async function main() {
  for (const { bannerId, localPath, objectKey } of MOBILE_BANNERS) {
    /* 1. Read the local file */
    console.log(`📂 Reading ${localPath} …`);
    const body = await readFile(localPath);

    /* 2. Upload to R2 */
    console.log(`☁️  Uploading to R2 → ${objectKey} …`);
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: objectKey,
        Body: body,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    const publicUrl = `${R2_PUBLIC}/${objectKey}`;
    console.log(`   ✅ Public URL: ${publicUrl}`);

    /* 3. Update Firestore document */
    const docRef = db.collection(BANNERS_COLLECTION).doc(`banner-${bannerId}`);
    const snap = await docRef.get();
    if (!snap.exists) {
      console.log(`   ⚠️  banner-${bannerId} not found in Firestore — skipping DB update.`);
      continue;
    }
    await docRef.update({ mobile_image_url: publicUrl });
    console.log(`   ✅ Firestore banner-${bannerId} updated with mobile_image_url`);
  }

  console.log("\n🎉 All done!");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Script failed:", err);
  process.exit(1);
});
