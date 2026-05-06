import { existsSync, readFileSync } from "fs";
import path from "path";

import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { getEnvValue } from "./env";

function resolveServiceAccountPath(rawPath: string): string {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  return path.resolve(process.cwd(), rawPath);
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}

function parseServiceAccountJson(): Record<string, unknown> | null {
  const rawJson = getEnvValue("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (rawJson) {
    return JSON.parse(rawJson);
  }

  const rawBase64 = getEnvValue("FIREBASE_SERVICE_ACCOUNT_BASE64");
  if (rawBase64) {
    return JSON.parse(Buffer.from(rawBase64, "base64").toString("utf8"));
  }

  return null;
}

function initFirebaseWithServiceAccount(serviceAccount: Record<string, unknown>) {
  const projectId = String(serviceAccount.project_id || serviceAccount.projectId || "").trim();
  const clientEmail = String(serviceAccount.client_email || serviceAccount.clientEmail || "").trim();
  const privateKey = normalizePrivateKey(String(serviceAccount.private_key || serviceAccount.privateKey || ""));

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase service account is missing project_id/client_email/private_key. Regenerate the Admin SDK JSON and update Railway variables."
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    projectId,
  });
}

function initFirebaseWithEnvCredentials() {
  const projectId = getEnvValue("FIREBASE_PROJECT_ID");
  const clientEmail = getEnvValue("FIREBASE_CLIENT_EMAIL");
  const privateKey = normalizePrivateKey(getEnvValue("FIREBASE_PRIVATE_KEY"));

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    projectId,
  });
}

function getFirebaseApp() {
  if (getApps().length) {
    return getApps()[0];
  }

  const serviceAccountJson = parseServiceAccountJson();
  if (serviceAccountJson) {
    return initFirebaseWithServiceAccount(serviceAccountJson);
  }

  const serviceAccountPath = getEnvValue("FIREBASE_SERVICE_ACCOUNT_PATH");
  if (serviceAccountPath) {
    const resolvedPath = resolveServiceAccountPath(serviceAccountPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_PATH file was not found at ${resolvedPath}. On Railway, use FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY instead of a local JSON file path.`
      );
    }

    const serviceAccount = JSON.parse(readFileSync(resolvedPath, "utf8"));
    return initFirebaseWithServiceAccount(serviceAccount);
  }

  const envCredentialsApp = initFirebaseWithEnvCredentials();
  if (envCredentialsApp) {
    return envCredentialsApp;
  }

  const googleProjectId = getEnvValue("GOOGLE_CLOUD_PROJECT") || getEnvValue("GCLOUD_PROJECT");
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || googleProjectId) {
    return initializeApp({
      credential: applicationDefault(),
      projectId: googleProjectId || undefined,
    });
  }

  throw new Error(
    "Firebase Admin SDK is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in Railway, or set FIREBASE_SERVICE_ACCOUNT_JSON/FIREBASE_SERVICE_ACCOUNT_BASE64."
  );
}

export const firebaseApp = getFirebaseApp();
export const firestore = getFirestore(firebaseApp);
