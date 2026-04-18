import { mkdir, readdir, stat } from "fs/promises";
import path from "path";

import sharp from "sharp";

const PROJECT_ROOT = process.cwd();
const ASSETS_ROOT = path.join(PROJECT_ROOT, "assets");
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

type GenerateProductThumbnailsOptions = {
  log?: boolean;
  maxSize?: number;
  quality?: number;
};

type GeneratedThumbnail = {
  sourcePath: string;
  thumbnailPath: string;
  generated: boolean;
};

function toPosixRelativePath(filePath: string): string {
  return path.relative(ASSETS_ROOT, filePath).replace(/\\/g, "/");
}

function shouldSkipRelativePath(relativePath: string): boolean {
  const segments = relativePath.split("/").filter(Boolean);
  return segments.includes("thumbs") || segments.includes("images");
}

async function collectSourceImages(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    const relativePath = toPosixRelativePath(entryPath);

    if (shouldSkipRelativePath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await collectSourceImages(entryPath)));
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      files.push(entryPath);
    }
  }

  return files;
}

function getThumbnailPath(sourcePath: string): string {
  const sourceDirectory = path.dirname(sourcePath);
  const sourceFileName = path.basename(sourcePath, path.extname(sourcePath));
  return path.join(sourceDirectory, "thumbs", `${sourceFileName}.webp`);
}

async function shouldGenerateThumbnail(
  sourcePath: string,
  thumbnailPath: string
): Promise<boolean> {
  const sourceStats = await stat(sourcePath);
  const thumbnailStats = await stat(thumbnailPath).catch(() => null);

  if (!thumbnailStats) {
    return true;
  }

  return thumbnailStats.mtimeMs < sourceStats.mtimeMs;
}

export async function generateProductThumbnails(
  options: GenerateProductThumbnailsOptions = {}
): Promise<GeneratedThumbnail[]> {
  const { log = false, maxSize = 720, quality = 82 } = options;
  const sourceImages = await collectSourceImages(ASSETS_ROOT);
  const results: GeneratedThumbnail[] = [];

  for (const sourcePath of sourceImages) {
    const thumbnailPath = getThumbnailPath(sourcePath);
    const thumbnailDirectory = path.dirname(thumbnailPath);
    const needsGeneration = await shouldGenerateThumbnail(sourcePath, thumbnailPath);

    if (!needsGeneration) {
      results.push({ sourcePath, thumbnailPath, generated: false });
      continue;
    }

    await mkdir(thumbnailDirectory, { recursive: true });

    await sharp(sourcePath)
      .rotate()
      .resize(maxSize, maxSize, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 0 },
        withoutEnlargement: true,
      })
      .webp({
        quality,
        alphaQuality: 100,
        effort: 6,
      })
      .toFile(thumbnailPath);

    results.push({ sourcePath, thumbnailPath, generated: true });

    if (log) {
      console.log(
        `[thumbnail] ${toPosixRelativePath(sourcePath)} -> ${toPosixRelativePath(
          thumbnailPath
        )}`
      );
    }
  }

  if (log) {
    const generatedCount = results.filter((result) => result.generated).length;
    console.log(
      `Product thumbnails ready. Generated ${generatedCount} of ${results.length} thumbnail files.`
    );
  }

  return results;
}
