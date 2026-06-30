// Shared helpers: load .env (incl. multiline quoted private key), make R2 + Firestore clients.
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../.env");

export function loadEnv() {
  const raw = readFileSync(ENV_PATH, "utf8");
  const out = {};
  let i = 0;
  const lines = raw.split(/\r?\n/);
  while (i < lines.length) {
    let line = lines[i];
    i++;
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1);
    if (val.startsWith('"')) {
      // possibly multiline until closing unescaped quote
      val = val.slice(1);
      let acc = "";
      while (true) {
        const endIdx = val.indexOf('"');
        if (endIdx !== -1) {
          acc += val.slice(0, endIdx);
          break;
        }
        acc += val + "\n";
        if (i >= lines.length) break;
        val = lines[i];
        i++;
      }
      out[key] = acc;
    } else {
      out[key] = val.trim();
    }
  }
  return out;
}

export async function makeClients(env) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const adminMod = await import("firebase-admin");
  const admin = adminMod.default;

  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: (env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
    });
  }
  const db = admin.firestore();
  return { r2, admin, db };
}
