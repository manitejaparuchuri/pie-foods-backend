/**
 * Compares document counts (and IDs) between OLD and NEW Firebase projects
 * after running migrate-firestore.ts --apply.
 *
 * Usage: npx ts-node src/scripts/verify-firestore-migration.ts
 */

import * as admin from "firebase-admin";
import * as path from "path";

const BACKEND_DIR = path.resolve(__dirname, "..", "..");
const OLD_KEY = path.join(BACKEND_DIR, "pie-foods-firebase-adminsdk-fbsvc-2d881a2ea3.json");
const NEW_KEY = path.join(BACKEND_DIR, "pie-foods-4bece-firebase-adminsdk-fbsvc-7a24e3bca8.json");

const oldKey = require(OLD_KEY) as admin.ServiceAccount & { project_id: string };
const newKey = require(NEW_KEY) as admin.ServiceAccount & { project_id: string };

const oldDb = admin
  .initializeApp({ credential: admin.credential.cert(oldKey), projectId: oldKey.project_id }, "old")
  .firestore();
const newDb = admin
  .initializeApp({ credential: admin.credential.cert(newKey), projectId: newKey.project_id }, "new")
  .firestore();

async function main() {
  const oldCols = await oldDb.listCollections();
  const newCols = await newDb.listCollections();

  console.log(`OLD: ${oldKey.project_id}   NEW: ${newKey.project_id}`);
  console.log("---");

  const oldNames = oldCols.map((c) => c.id).sort();
  const newNames = newCols.map((c) => c.id).sort();
  console.log(`Collections   OLD: [${oldNames.join(", ")}]`);
  console.log(`Collections   NEW: [${newNames.join(", ")}]`);
  console.log("");

  let mismatch = false;
  for (const colId of oldNames) {
    const [oldSnap, newSnap] = await Promise.all([
      oldDb.collection(colId).get(),
      newDb.collection(colId).get(),
    ]);
    const oldIds = oldSnap.docs.map((d) => d.id).sort();
    const newIds = newSnap.docs.map((d) => d.id).sort();
    const match = oldIds.length === newIds.length && oldIds.every((id, i) => id === newIds[i]);
    console.log(
      `  ${colId.padEnd(15)}  old=${String(oldSnap.size).padStart(3)}  new=${String(newSnap.size).padStart(3)}  ${match ? "OK" : "MISMATCH"}`
    );
    if (!match) {
      mismatch = true;
      const missing = oldIds.filter((id) => !newIds.includes(id));
      const extra = newIds.filter((id) => !oldIds.includes(id));
      if (missing.length) console.log(`    missing in NEW: ${missing.join(", ")}`);
      if (extra.length) console.log(`    extra in NEW:   ${extra.join(", ")}`);
    }
  }

  console.log("---");
  console.log(mismatch ? "Verification: MISMATCH found." : "Verification: all collections match.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
