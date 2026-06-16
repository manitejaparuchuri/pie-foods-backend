/**
 * One-time cleanup: deletes ALL orders + related payment records, and
 * resets the per-day order-number counters so the next real customer
 * order starts at PF<YYMMDD>0001.
 *
 * Use this BEFORE going live to clear out test orders from Firestore
 * so the admin panel starts fresh with real customer orders only.
 *
 * Collections cleared:
 *   • orders                    — every order document
 *   • payments                  — every payment record
 *   • payment_webhook_events    — every Razorpay webhook log
 *   • meta/order_counter_*      — per-day order-number counter docs
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

/**
 * Reset per-day order-number counter docs (meta/order_counter_*) so the
 * next real order starts at PF<YYMMDD>0001 rather than continuing the
 * sequence that test orders ticked forward.
 */
async function resetOrderCounters(): Promise<number> {
  const snap = await firestore.collection("meta").get();
  const counterDocs = snap.docs.filter((doc) =>
    doc.id.startsWith("order_counter_")
  );
  const total = counterDocs.length;

  if (total === 0) {
    console.log("  [meta/order_counter_*] none found");
    return 0;
  }

  if (!APPLY) {
    console.log(`  [meta/order_counter_*] would reset ${total} counter(s)`);
    return total;
  }

  let batch = firestore.batch();
  let pending = 0;
  let deleted = 0;
  for (const doc of counterDocs) {
    batch.delete(doc.ref);
    pending++;
    if (pending >= BATCH_SIZE) {
      await batch.commit();
      deleted += pending;
      batch = firestore.batch();
      pending = 0;
    }
  }
  if (pending > 0) {
    await batch.commit();
    deleted += pending;
  }
  console.log(`  [meta/order_counter_*] reset ${deleted} counter(s) ✓`);
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

  const countersReset = await resetOrderCounters();
  grandTotal += countersReset;

  console.log("\n=========================================");
  if (APPLY) {
    console.log(
      `Done. Deleted ${grandTotal} document(s) across ${COLLECTIONS.length} collections + ${countersReset} counter(s).`
    );
    console.log("Next real order will be PF<YYMMDD>0001.");
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
