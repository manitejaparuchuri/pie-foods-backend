import dotenv from "dotenv";
import { mkdir, readdir, stat, writeFile } from "fs/promises";
import path from "path";

import db from "../config/db";
import {
  getMissingR2EnvVars,
  isR2Configured,
  uploadFileToR2,
} from "../config/r2";
import { getAvailableProductImageFields } from "../utils/product-columns";
import { generateProductThumbnails } from "../utils/product-thumbnails";

dotenv.config({ override: true });

const PROJECT_ROOT = process.cwd();
const ASSETS_ROOT = path.join(PROJECT_ROOT, "assets");
const MANIFEST_DIR = path.join(PROJECT_ROOT, "tmp");
const MANIFEST_PATH = path.join(MANIFEST_DIR, "r2-upload-manifest.json");

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

type UploadedAsset = {
  assetPath: string;
  publicUrl: string;
};

const getEnv = (key: string): string => String(process.env[key] || "").trim();

function hasDatabaseConfig(): boolean {
  return ["DB_HOST", "DB_USER", "DB_PASS", "DB_NAME"].every((key) => !!getEnv(key));
}

async function collectAssetFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectAssetFiles(entryPath)));
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) {
      files.push(entryPath);
    }
  }

  return files;
}

function toPosixRelativePath(filePath: string): string {
  return path.relative(ASSETS_ROOT, filePath).replace(/\\/g, "/");
}

function buildObjectKey(filePath: string): string {
  return `products/${toPosixRelativePath(filePath)}`;
}

function buildExistingUrlCandidates(filePath: string): string[] {
  const relativePath = toPosixRelativePath(filePath);
  const fileName = path.basename(filePath);

  return Array.from(
    new Set([
      fileName,
      relativePath,
      `/${relativePath}`,
      `assets/${relativePath}`,
      `/assets/${relativePath}`,
      `images/${fileName}`,
      `/images/${fileName}`,
      `assets/images/${fileName}`,
      `/assets/images/${fileName}`,
      `assets/${fileName}`,
      `/assets/${fileName}`,
    ])
  );
}

async function maybeSyncDatabase(uploadedAssets: UploadedAsset[]): Promise<void> {
  if (!hasDatabaseConfig()) {
    console.log("Database env vars not found. Skipping image_url updates in MySQL.");
    return;
  }

  try {
    const productImageFields = await getAvailableProductImageFields();
    let updatedProductFields = 0;
    let updatedCategoryFields = 0;

    for (const uploadedAsset of uploadedAssets) {
      if (uploadedAsset.assetPath.split("/").includes("thumbs")) {
        continue;
      }

      const localFilePath = path.join(ASSETS_ROOT, uploadedAsset.assetPath);
      const candidates = buildExistingUrlCandidates(localFilePath);
      const placeholders = candidates.map(() => "?").join(", ");

      for (const field of productImageFields) {
        const [result]: any = await db.query(
          `UPDATE products
           SET ${field} = ?
           WHERE ${field} IN (${placeholders})`,
          [uploadedAsset.publicUrl, ...candidates]
        );
        updatedProductFields += Number(result?.affectedRows || 0);
      }

      const [categoryResult]: any = await db.query(
        `UPDATE categories
         SET image_url = ?
         WHERE image_url IN (${placeholders})`,
        [uploadedAsset.publicUrl, ...candidates]
      );
      updatedCategoryFields += Number(categoryResult?.affectedRows || 0);
    }

    console.log(
      `MySQL image references updated. Product fields: ${updatedProductFields}, category fields: ${updatedCategoryFields}`
    );
  } finally {
    await db.end();
  }
}

async function writeManifest(uploadedAssets: UploadedAsset[]): Promise<void> {
  await mkdir(MANIFEST_DIR, { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(uploadedAssets, null, 2), "utf8");
  console.log(`Upload manifest written to ${MANIFEST_PATH}`);
}

async function main(): Promise<void> {
  if (!isR2Configured()) {
    throw new Error(
      `R2 is not configured. Missing: ${getMissingR2EnvVars().join(", ")}`
    );
  }

  const assetsExists = await stat(ASSETS_ROOT).then(
    (info) => info.isDirectory(),
    () => false
  );

  if (!assetsExists) {
    throw new Error(`Assets directory not found at ${ASSETS_ROOT}`);
  }

  await generateProductThumbnails({ log: true });

  const assetFiles = (await collectAssetFiles(ASSETS_ROOT)).sort((a, b) =>
    a.localeCompare(b)
  );

  if (!assetFiles.length) {
    console.log("No image files found in the assets directory.");
    return;
  }

  console.log(`Uploading ${assetFiles.length} asset files to Cloudflare R2...`);

  const uploadedAssets: UploadedAsset[] = [];
  for (const filePath of assetFiles) {
    const assetPath = toPosixRelativePath(filePath);
    const publicUrl = await uploadFileToR2(filePath, buildObjectKey(filePath));
    uploadedAssets.push({ assetPath, publicUrl });
    console.log(`[uploaded] ${assetPath} -> ${publicUrl}`);
  }

  await writeManifest(uploadedAssets);
  try {
    await maybeSyncDatabase(uploadedAssets);
  } catch (error) {
    console.warn("R2 upload completed, but MySQL image sync was skipped.");
    console.warn(error);
    console.warn(
      "Make sure DB_NAME points to an existing database with the PIE Foods tables, then rerun npm run r2:sync-assets."
    );
    return;
  }
  console.log("R2 asset sync complete.");
}

void main().catch((error) => {
  console.error("R2 asset sync failed:", error);
  process.exitCode = 1;
});
