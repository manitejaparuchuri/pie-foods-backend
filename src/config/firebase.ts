import { readFileSync } from "fs";
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

function getFirebaseApp() {
  if (getApps().length) {
    return getApps()[0];
  }

  const serviceAccountPath = getEnvValue("FIREBASE_SERVICE_ACCOUNT_PATH");
  if (serviceAccountPath) {
    const resolvedPath = resolveServiceAccountPath(serviceAccountPath);
    const serviceAccount = JSON.parse(readFileSync(resolvedPath, "utf8"));
    return initializeApp({
      credential: cert(serviceAccount),
    });
  }

  const projectId = getEnvValue("FIREBASE_PROJECT_ID");
  const clientEmail = getEnvValue("FIREBASE_CLIENT_EMAIL");
  const privateKey = getEnvValue("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  return initializeApp({
    credential: applicationDefault(),
  });
}

export const firebaseApp = getFirebaseApp();
export const firestore = getFirestore(firebaseApp);
