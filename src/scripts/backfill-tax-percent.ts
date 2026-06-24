/**
 * One-time backfill: set tax_percent = 5 on every Firestore product doc that
 * is missing the field or holds a non-finite / out-of-range value.
 *
 * Why: the admin form was silently defaulting blank tax % to 5 on save, and
 * the read-side mappers were silently coercing missing values to 5 too. Once
 * those silent defaults are removed, every existing product becomes "missing
 * a tax rate" and breaks the admin Edit form (Validators.required blocks
 * Update). This script makes every existing product carry tax_percent
 * explicitly so the strict validation can ship without locking the catalog.
 *
 * Usage (from pie-foods-backend/):
 *
 *   # 1. Dry run — counts and lists what would change, no writes
 *   npx ts-node src/scripts/backfill-tax-percent.ts
 *
 *   # 2. Apply — actually writes tax_percent on every offending doc
 *   npx ts-node src/scripts/backfill-tax-percent.ts --apply
 *
 * NODE_TLS_REJECT_UNAUTHORIZED=0 may be needed on corporate networks that
 * intercept the Firestore HTTPS cert (the same workaround we already use for
 * gcloud / npm on this machine).
 *
 * Targets the same Firebase project the live server uses (config/firebase).
 */

import "./_load-env-yaml";

import { Timestamp } from "firebase-admin/firestore";

import { firestore } from "../config/firebase";
import { getFirestoreProductsCollectionName } from "../config/catalog";

const APPLY = process.argv.includes("--apply");

/** Default rate stamped onto products that have no usable tax_percent today.
 *  Food / monk-fruit / freeze-dried fruit all sit on the 5% slab in the GST
 *  schedule, so 5 is the safe historical answer. Admin can edit per product
 *  after the backfill if any item needs 12/18/28. */
const DEFAULT_TAX_PERCENT = 5;
const MIN_TAX_PERCENT = 0;
const MAX_TAX_PERCENT = 50;

// Prefer REST transport — gRPC is blocked by many corporate networks.
firestore.settings({ preferRest: true });

interface BackfillResult {
  productId: string;
  reason: "missing" | "non-finite" | "out-of-range";
  previousValue: unknown;
}

function classifyTaxPercent(raw: unknown):
  | { ok: true }
  | { ok: false; reason: BackfillResult["reason"]; previousValue: unknown } {
  if (raw === undefined || raw === null) {
    return { ok: false, reason: "missing", previousValue: raw };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: "non-finite", previousValue: raw };
  }
  if (n < MIN_TAX_PERCENT || n > MAX_TAX_PERCENT) {
    return { ok: false, reason: "out-of-range", previousValue: raw };
  }
  return { ok: true };
}

async function backfillProducts(): Promise<void> {
  const collectionName = getFirestoreProductsCollectionName();
  console.log(`\nScanning products collection: ${collectionName}`);

  const snapshot = await firestore.collection(collectionName).get();
  if (snapshot.empty) {
    console.log("No product docs found. Nothing to backfill.\n");
    return;
  }

  const toBackfill: BackfillResult[] = [];
  let alreadyOk = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const verdict = classifyTaxPercent(data.tax_percent);
    if (verdict.ok) {
      alreadyOk += 1;
      continue;
    }
    toBackfill.push({
      productId: doc.id,
      reason: verdict.reason,
      previousValue: verdict.previousValue,
    });
  }

  console.log(
    `Scanned ${snapshot.size} doc(s). ${alreadyOk} already have a valid tax_percent.`
  );
  console.log(`${toBackfill.length} doc(s) need backfill:\n`);

  for (const row of toBackfill) {
    const prev =
      row.previousValue === undefined
        ? "(missing)"
        : JSON.stringify(row.previousValue);
    console.log(
      `  - ${collectionName}/${row.productId}  reason=${row.reason}  was=${prev}  → ${DEFAULT_TAX_PERCENT}`
    );
  }

  if (!APPLY) {
    console.log(
      `\nDry run — no writes performed. Re-run with --apply to write tax_percent=${DEFAULT_TAX_PERCENT}.\n`
    );
    return;
  }

  if (toBackfill.length === 0) {
    console.log("\nNothing to apply.\n");
    return;
  }

  console.log(`\nApplying tax_percent=${DEFAULT_TAX_PERCENT} to ${toBackfill.length} doc(s)...`);

  // Firestore batches cap at 500 ops — chunk at 400 for headroom.
  const CHUNK = 400;
  const now = Timestamp.now();
  let writtenSoFar = 0;

  for (let offset = 0; offset < toBackfill.length; offset += CHUNK) {
    const slice = toBackfill.slice(offset, offset + CHUNK);
    const batch = firestore.batch();
    for (const row of slice) {
      const ref = firestore.collection(collectionName).doc(row.productId);
      batch.update(ref, {
        tax_percent: DEFAULT_TAX_PERCENT,
        updated_at: now,
      });
    }
    await batch.commit();
    writtenSoFar += slice.length;
    console.log(`  wrote ${writtenSoFar}/${toBackfill.length}`);
  }

  console.log(`\nDone — backfilled ${writtenSoFar} product(s).\n`);
}

async function main(): Promise<void> {
  console.log(APPLY ? "APPLY MODE — will write to Firestore." : "DRY RUN — no writes.");
  await backfillProducts();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("BACKFILL ERROR:", err);
    process.exit(1);
  });
