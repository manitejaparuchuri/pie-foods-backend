/**
 * Cron-friendly cleanup: deletes orders that have been stuck in
 * PENDING_PAYMENT for longer than the configured threshold.
 *
 * These are orders where the customer hit "Proceed to Payment" but never
 * completed payment (closed the tab, payment failed silently, abandoned cart).
 * They contribute zero revenue, accumulate in Firestore, and clutter admin
 * views. After 24 hours they're effectively dead.
 *
 * Also deletes expired OTP codes from the otp_codes collection.
 *
 * Usage:
 *   npx ts-node src/scripts/cleanup-stale-pending-orders.ts            (dry run)
 *   npx ts-node src/scripts/cleanup-stale-pending-orders.ts --apply    (delete)
 *
 * Optional flags:
 *   --hours=24       (default: how old before considered stale)
 *
 * Recommended cadence: run daily via cron, GitHub Action, or Railway cron.
 */

import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";

const APPLY = process.argv.includes("--apply");
const hoursArg = process.argv.find((a) => a.startsWith("--hours="));
const STALE_HOURS = hoursArg ? Number(hoursArg.split("=")[1]) || 24 : 24;
const BATCH_SIZE = 400;

const ordersCollection = firestore.collection("orders");
const otpCollection = firestore.collection("otp_codes");

async function cleanupStaleOrders(): Promise<number> {
  const cutoff = Timestamp.fromMillis(Date.now() - STALE_HOURS * 60 * 60 * 1000);
  const snap = await ordersCollection
    .where("status", "==", "PENDING_PAYMENT")
    .where("order_date", "<", cutoff)
    .limit(1000)
    .get();

  if (snap.empty) {
    console.log(`  [orders] no stale PENDING_PAYMENT orders older than ${STALE_HOURS}h`);
    return 0;
  }

  if (!APPLY) {
    console.log(`  [orders] would delete ${snap.size} stale PENDING_PAYMENT order(s)`);
    snap.docs.slice(0, 5).forEach((doc) => {
      const data = doc.data();
      console.log(`    • ${doc.id} (email: ${data.customer_email || data.user_id || "?"})`);
    });
    if (snap.size > 5) console.log(`    … and ${snap.size - 5} more`);
    return snap.size;
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
      batch = firestore.batch();
      pending = 0;
    }
  }
  if (pending > 0) {
    await batch.commit();
    deleted += pending;
  }
  console.log(`  [orders] deleted ${deleted} stale PENDING_PAYMENT order(s) ✓`);
  return deleted;
}

async function cleanupExpiredOtps(): Promise<number> {
  const now = Timestamp.now();
  const snap = await otpCollection.where("expires_at", "<", now).limit(1000).get();

  if (snap.empty) {
    console.log("  [otp_codes] no expired codes");
    return 0;
  }

  if (!APPLY) {
    console.log(`  [otp_codes] would delete ${snap.size} expired code(s)`);
    return snap.size;
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
      batch = firestore.batch();
      pending = 0;
    }
  }
  if (pending > 0) {
    await batch.commit();
    deleted += pending;
  }
  console.log(`  [otp_codes] deleted ${deleted} expired code(s) ✓`);
  return deleted;
}

async function main(): Promise<void> {
  console.log("\n=========================================");
  console.log(`Mode: ${APPLY ? "APPLY (deleting)" : "DRY RUN"}`);
  console.log(`Stale threshold: ${STALE_HOURS} hours`);
  console.log("=========================================\n");

  const ordersDeleted = await cleanupStaleOrders();
  const otpsDeleted = await cleanupExpiredOtps();

  console.log("\n=========================================");
  console.log(
    `Done. ${APPLY ? "Deleted" : "Would delete"}: ${ordersDeleted} order(s), ${otpsDeleted} OTP code(s).`
  );
  if (!APPLY) {
    console.log("Re-run with --apply to actually delete.");
  }
  console.log("=========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("CLEANUP ERROR:", err);
    process.exit(1);
  });
