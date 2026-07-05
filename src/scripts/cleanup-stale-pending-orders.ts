/**
 * Cron-friendly cleanup: RE-LABELS orders stuck in PENDING_PAYMENT for longer
 * than the configured threshold to status ABANDONED_PAYMENT.
 *
 * These are orders where the customer hit "Proceed to Payment" but never
 * completed payment (closed the tab, payment failed silently, abandoned cart).
 * The business WANTS to keep these leads — full name / phone / email / address /
 * cart are captured on the doc — so they can review and follow up. We therefore
 * mark them ABANDONED_PAYMENT (which the admin panel filters out of "live"
 * orders and into an Abandoned view) instead of DELETING them. Nothing is lost.
 *
 * Also deletes expired OTP codes from the otp_codes collection (those are
 * throwaway one-time codes, safe to purge).
 *
 * Usage:
 *   npx ts-node src/scripts/cleanup-stale-pending-orders.ts            (dry run)
 *   npx ts-node src/scripts/cleanup-stale-pending-orders.ts --apply    (relabel)
 *
 * Optional flags:
 *   --hours=24       (default: how old before considered stale/abandoned)
 *
 * Recommended cadence: run daily via cron, GitHub Action, or Railway cron.
 */

import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";

const APPLY = process.argv.includes("--apply");
const hoursArg = process.argv.find((a) => a.startsWith("--hours="));
const STALE_HOURS = hoursArg ? Number(hoursArg.split("=")[1]) || 24 : 24;
const BATCH_SIZE = 400;

/** Status we move stale unpaid orders to (retained, not deleted). */
export const ABANDONED_STATUS = "ABANDONED_PAYMENT";

const ordersCollection = firestore.collection("orders");
const otpCollection = firestore.collection("otp_codes");

async function relabelStaleOrders(): Promise<number> {
  const cutoffMillis = Date.now() - STALE_HOURS * 60 * 60 * 1000;

  // Single-field equality on status (no composite index needed); filter date in memory.
  const snap = await ordersCollection
    .where("status", "==", "PENDING_PAYMENT")
    .limit(1000)
    .get();

  const staleDocs = snap.docs.filter((doc) => {
    const ts = doc.data().order_date as Timestamp | undefined;
    return ts && ts.toMillis() < cutoffMillis;
  });

  if (staleDocs.length === 0) {
    console.log(`  [orders] no stale PENDING_PAYMENT orders older than ${STALE_HOURS}h`);
    return 0;
  }

  if (!APPLY) {
    console.log(`  [orders] would mark ${staleDocs.length} stale order(s) as ${ABANDONED_STATUS} (retained)`);
    staleDocs.slice(0, 5).forEach((doc) => {
      const data = doc.data();
      console.log(`    • ${doc.id} (email: ${data.customer_email || data.user_id || "?"})`);
    });
    if (staleDocs.length > 5) console.log(`    … and ${staleDocs.length - 5} more`);
    return staleDocs.length;
  }

  let updated = 0;
  let batch = firestore.batch();
  let pending = 0;
  for (const doc of staleDocs) {
    batch.update(doc.ref, {
      status: ABANDONED_STATUS,
      abandoned_at: Timestamp.now(),
      updated_at: Timestamp.now(),
    });
    pending++;
    if (pending >= BATCH_SIZE) {
      await batch.commit();
      updated += pending;
      batch = firestore.batch();
      pending = 0;
    }
  }
  if (pending > 0) {
    await batch.commit();
    updated += pending;
  }
  console.log(`  [orders] marked ${updated} order(s) as ${ABANDONED_STATUS} (retained for follow-up) ✓`);
  return updated;
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
  console.log(`Mode: ${APPLY ? "APPLY (relabeling + otp purge)" : "DRY RUN"}`);
  console.log(`Stale threshold: ${STALE_HOURS} hours`);
  console.log("Orders are RETAINED (marked ABANDONED_PAYMENT), not deleted.");
  console.log("=========================================\n");

  const ordersRelabelled = await relabelStaleOrders();
  const otpsDeleted = await cleanupExpiredOtps();

  console.log("\n=========================================");
  console.log(
    `Done. ${APPLY ? "Marked abandoned" : "Would mark abandoned"}: ${ordersRelabelled} order(s) (retained). ${APPLY ? "Deleted" : "Would delete"}: ${otpsDeleted} OTP code(s).`
  );
  if (!APPLY) {
    console.log("Re-run with --apply to actually relabel orders + purge OTPs.");
  }
  console.log("=========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("CLEANUP ERROR:", err);
    process.exit(1);
  });
