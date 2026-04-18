import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readFile } from "fs/promises";
import { extname } from "path";

const R2_REQUIRED_ENV_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_BASE_URL",
] as const;

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

let r2Client: S3Client | null = null;

const getEnv = (key: string): string => String(process.env[key] || "").trim();

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const encodeObjectKeyForUrl = (objectKey: string): string =>
  objectKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export function getMissingR2EnvVars(): string[] {
  return R2_REQUIRED_ENV_VARS.filter((key) => !getEnv(key));
}

export function isR2Configured(): boolean {
  return getMissingR2EnvVars().length === 0;
}

export function normalizeR2ObjectKey(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

export function getR2PublicBaseUrl(): string {
  const publicBaseUrl = trimTrailingSlash(getEnv("R2_PUBLIC_BASE_URL"));
  if (!publicBaseUrl) {
    throw new Error("R2_PUBLIC_BASE_URL is not configured");
  }
  return publicBaseUrl;
}

function getR2Client(): S3Client {
  if (!isR2Configured()) {
    throw new Error(
      `R2 is not configured. Missing: ${getMissingR2EnvVars().join(", ")}`
    );
  }

  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${getEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: getEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: getEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }

  return r2Client;
}

function guessContentType(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  return CONTENT_TYPES_BY_EXTENSION[extension] || "application/octet-stream";
}

export function buildR2PublicUrl(objectKey: string): string {
  const normalizedObjectKey = normalizeR2ObjectKey(objectKey);
  return `${getR2PublicBaseUrl()}/${encodeObjectKeyForUrl(normalizedObjectKey)}`;
}

interface UploadToR2Options {
  objectKey: string;
  body: Buffer;
  cacheControl?: string;
  contentType?: string;
}

export async function uploadBufferToR2({
  objectKey,
  body,
  cacheControl = "public, max-age=31536000, immutable",
  contentType,
}: UploadToR2Options): Promise<string> {
  const normalizedObjectKey = normalizeR2ObjectKey(objectKey);

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getEnv("R2_BUCKET_NAME"),
      Key: normalizedObjectKey,
      Body: body,
      CacheControl: cacheControl,
      ContentType: contentType || guessContentType(normalizedObjectKey),
    })
  );

  return buildR2PublicUrl(normalizedObjectKey);
}

export async function uploadFileToR2(
  localFilePath: string,
  objectKey: string
): Promise<string> {
  const body = await readFile(localFilePath);
  return uploadBufferToR2({ body, objectKey });
}
