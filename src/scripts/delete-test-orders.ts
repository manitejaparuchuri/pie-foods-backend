/**
 * One-time cleanup: deletes ALL orders + related payment records.
 *
 * Use this BEFORE going live to clear out test orders from Firestore
 * so the admin panel starts fresh with real customer orders only.
 *
 * Collections cleared:
 *   • orders                    — every order document
 *   • payments                  — every payment record
 *   • payment_webhook_events    — every Razorpay webhook log
 *
 * Usage:
 *   npx ts-node src/scripts/delete-test-orders.ts          (dry run — counts only)
 *   npx ts-node src/scripts/delete-test-orders.ts --apply  (actually delete)
 *
 * ⚠️  WARNING: --apply is irreversible. Only run this BEFORE go-live, or when
 *     you specifically want to wipe all order history.
 */

import { firestore } from "../config/firebase";

const APPLY = process.argv.includes("--apply");

const COLLECTIONS = [
  "orders",
  "payments",
  "payment_webhook_events",
] as const;

const BATCH_SIZE = 400; // Firestore batch limit is 500; leave headroom

async function deleteCollection(collectionName: string): Promise<number> {
  const snap = await firestore.collection(collectionName).get();
  const total = snap.size;

  if (total === 0) {
    console.log(`  [${collectionName}] empty — nothing to delete`);
    return 0;
  }

  if (!APPLY) {
    console.log(`  [${collectionName}] would delete ${total} document(s)`);
    return total;
  }

  let deleted = 0;
  let batch = firestore.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    pending++;
    if (pending >= BATCH_SIZE) {
      await batch.commit();
      deleted += pending;
      console.log(`  [${collectionName}] deleted ${deleted}/${total}…`);
      batch = firestore.batch();
      pending = 0;
    }
  }

  if (pending > 0) {
    await batch.commit();
    deleted += pending;
  }

  console.log(`  [${collectionName}] deleted ${deleted} document(s) ✓`);
  return deleted;
}

async function main(): Promise<void> {
  console.log("\n=========================================");
  console.log(`Mode: ${APPLY ? "APPLY (deleting)" : "DRY RUN (counts only)"}`);
  console.log("=========================================\n");

  let grandTotal = 0;
  for (const name of COLLECTIONS) {
    const count = await deleteCollection(name);
    grandTotal += count;
  }

  console.log("\n=========================================");
  if (APPLY) {
    console.log(`Done. Deleted ${grandTotal} document(s) across ${COLLECTIONS.length} collections.`);
  } else {
    console.log(`Dry run finished. Would delete ${grandTotal} document(s).`);
    console.log("Re-run with --apply to actually delete:");
    console.log("  npx ts-node src/scripts/delete-test-orders.ts --apply");
  }
  console.log("=========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  });
