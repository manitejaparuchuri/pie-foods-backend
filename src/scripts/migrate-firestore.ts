/**
 * One-time Firestore migration: copies every collection (and subcollection)
 * from the OLD Firebase project to the NEW Firebase project, preserving
 * document IDs and data.
 *
 * Usage:
 *   npx ts-node src/scripts/migrate-firestore.ts          # dry-run (read-only)
 *   npx ts-node src/scripts/migrate-firestore.ts --apply  # actually write
 */

import * as admin from "firebase-admin";
import * as path from "path";

const BACKEND_DIR = path.resolve(__dirname, "..", "..");
const OLD_KEY = path.join(BACKEND_DIR, "pie-foods-firebase-adminsdk-fbsvc-2d881a2ea3.json");
const NEW_KEY = path.join(BACKEND_DIR, "pie-foods-4bece-firebase-adminsdk-fbsvc-7a24e3bca8.json");

const APPLY = process.argv.includes("--apply");

const oldKey = require(OLD_KEY) as admin.ServiceAccount & { project_id: string };
const newKey = require(NEW_KEY) as admin.ServiceAccount & { project_id: string };

const oldApp = admin.initializeApp(
  { credential: admin.credential.cert(oldKey), projectId: oldKey.project_id },
  "old"
);
const newApp = admin.initializeApp(
  { credential: admin.credential.cert(newKey), projectId: newKey.project_id },
  "new"
);

const oldDb = oldApp.firestore();
const newDb = newApp.firestore();

let totalDocs = 0;
let totalCollections = 0;

async function copyCollection(
  srcRef: FirebaseFirestore.CollectionReference,
  dstRef: FirebaseFirestore.CollectionReference,
  depth = 0
): Promise<void> {
  const indent = "  ".repeat(depth);
  totalCollections += 1;

  const snap = await srcRef.get();
  console.log(`${indent}- ${srcRef.path}  (${snap.size} docs)`);

  if (APPLY && snap.size > 0) {
    let batch = newDb.batch();
    let opCount = 0;
    for (const doc of snap.docs) {
      batch.set(dstRef.doc(doc.id), doc.data());
      opCount += 1;
      if (opCount >= 400) {
        await batch.commit();
        batch = newDb.batch();
        opCount = 0;
      }
    }
    if (opCount > 0) await batch.commit();
  }

  totalDocs += snap.size;

  for (const doc of snap.docs) {
    const subCols = await doc.ref.listCollections();
    for (const sub of subCols) {
      await copyCollection(sub, dstRef.doc(doc.id).collection(sub.id), depth + 1);
    }
  }
}

async function main() {
  console.log(`OLD project: ${oldKey.project_id}`);
  console.log(`NEW project: ${newKey.project_id}`);
  console.log(`Mode: ${APPLY ? "APPLY (writing to new project)" : "DRY RUN (read-only)"}`);
  console.log("---");

  const rootCollections = await oldDb.listCollections();
  if (rootCollections.length === 0) {
    console.log("No collections found in old project. Nothing to migrate.");
    return;
  }

  for (const col of rootCollections) {
    await copyCollection(col, newDb.collection(col.id));
  }

  console.log("---");
  console.log(`Collections traversed: ${totalCollections}`);
  console.log(`Documents ${APPLY ? "copied" : "found"}: ${totalDocs}`);
  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to actually write to the new project.");
  } else {
    console.log("\nMigration complete.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
