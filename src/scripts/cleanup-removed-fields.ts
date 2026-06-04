/**
 * One-time cleanup: strips retired fields from existing Firestore docs.
 *
 *   Categories:  description, image_url
 *   Products:    details, specifications, counter_details, warranty_installation
 *
 * These fields are no longer written or read by the app. New saves already
 * delete them (via FieldValue.delete in upsertCategory/upsertProduct); this
 * script removes them from ALL existing docs in one pass.
 *
 * Usage:
 *   npx ts-node src/scripts/cleanup-removed-fields.ts          (dry run — counts only)
 *   npx ts-node src/scripts/cleanup-removed-fields.ts --apply  (actually delete)
 *
 * Targets the same Firebase project the server uses (config/firebase).
 */

import { FieldValue } from "firebase-admin/firestore";

import { firestore } from "../config/firebase";
import {
  getFirestoreCategoriesCollectionName,
  getFirestoreProductsCollectionName,
} from "../config/catalog";

const APPLY = process.argv.includes("--apply");

const CATEGORY_FIELDS = ["description", "image_url"] as const;
const PRODUCT_FIELDS = ["details", "specifications", "counter_details", "warranty_installation"] as const;

async function cleanupCollection(collectionName: string, fields: readonly string[]): Promise<void> {
  const snapshot = await firestore.collection(collectionName).get();
  let docsWithStaleFields = 0;
  let batch = firestore.batch();
  let pending = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const present = fields.filter((field) => Object.prototype.hasOwnProperty.call(data, field));
    if (present.length === 0) {
      continue;
    }

    docsWithStaleFields += 1;
    console.log(`  ${collectionName}/${doc.id}: ${present.join(", ")}`);

    if (APPLY) {
      const update: Record<string, unknown> = {};
      for (const field of present) {
        update[field] = FieldValue.delete();
      }
      batch.update(doc.ref, update);
      pending += 1;

      // Firestore batches cap at 500 writes.
      if (pending >= 400) {
        await batch.commit();
        batch = firestore.batch();
        pending = 0;
      }
    }
  }

  if (APPLY && pending > 0) {
    await batch.commit();
  }

  console.log(
    `${collectionName}: ${docsWithStaleFields}/${snapshot.size} doc(s) had stale fields` +
      (APPLY ? " — cleaned." : " — dry run (no changes).")
  );
}

async function main(): Promise<void> {
  console.log(APPLY ? "APPLYING field cleanup...\n" : "DRY RUN (pass --apply to delete)\n");
  await cleanupCollection(getFirestoreCategoriesCollectionName(), CATEGORY_FIELDS);
  await cleanupCollection(getFirestoreProductsCollectionName(), PRODUCT_FIELDS);
  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("CLEANUP ERROR:", error);
    process.exit(1);
  });
