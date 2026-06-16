/**
 * Same as delete-test-orders.ts, but forces the Firestore client to use
 * REST/HTTPS transport instead of gRPC. Useful when running locally on
 * networks with SSL inspection that breaks the gRPC connection.
 *
 * Usage:
 *   npx ts-node src/scripts/delete-test-orders-rest.ts          (dry run)
 *   npx ts-node src/scripts/delete-test-orders-rest.ts --apply  (actually delete)
 */

import { firestore } from "../config/firebase";

// Force HTTPS/REST instead of gRPC. Bypasses SSL-inspection breakage on
// corporate networks where the gRPC stream can't validate the cert chain.
firestore.settings({ preferRest: true });

const APPLY = process.argv.includes("--apply");

const COLLECTIONS = ["orders", "payments", "payment_webhook_events"] as const;
const BATCH_SIZE = 400;

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
  console.log("Transport: REST (preferRest=true)");
  console.log("=========================================\n");

  let grandTotal = 0;
  for (const name of COLLECTIONS) {
    grandTotal += await deleteCollection(name);
  }
  const countersReset = await resetOrderCounters();
  grandTotal += countersReset;

  console.log("\n=========================================");
  if (APPLY) {
    console.log(`Done. Deleted ${grandTotal} document(s) + ${countersReset} counter(s).`);
    console.log("Next real order will be PF<YYMMDD>0001.");
  } else {
    console.log(`Dry run finished. Would delete ${grandTotal} document(s).`);
    console.log("Re-run with --apply to actually delete.");
  }
  console.log("=========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  });
