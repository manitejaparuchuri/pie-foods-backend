import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";

/* ===================================================================
   Order Number Service
   ===================================================================
   Generates human-friendly order numbers in the format:

       PF<YYMMDD><NNNN>     e.g. PF2606120001

   Each day has its own counter that resets at midnight IST. Sequences
   are produced via an atomic Firestore transaction so concurrent order
   creations can never share a number.

   Counter document layout:
       meta/order_counter_<YYMMDD>  { date_key, count, last_updated }

   We pre-generate the number BEFORE the order create transaction —
   this keeps order create logic simple and avoids nesting transactions.
   If the outer transaction fails, the counter still ticks forward; the
   result is an occasional gap in the sequence, which is harmless.
   =================================================================== */

const COUNTERS_DOC_PREFIX = "order_counter_";
const metaCollection = firestore.collection("meta");

/** Compute today's date in IST as YYMMDD. Railway runs UTC. */
function getIstDateKey(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  const yy = String(ist.getUTCFullYear()).slice(-2);
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function formatOrderNumber(dateKey: string, sequence: number): string {
  return `PF${dateKey}${String(sequence).padStart(4, "0")}`;
}

/**
 * Generate the next order number for today (IST).
 *
 * Returns something like `PF2606120001`. Numbers within the same IST day
 * are strictly increasing; the counter rolls over to 0001 at IST midnight.
 */
export async function generateOrderNumber(): Promise<string> {
  const dateKey = getIstDateKey();
  const counterRef = metaCollection.doc(`${COUNTERS_DOC_PREFIX}${dateKey}`);

  const next = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists
      ? Number((snap.data() as Record<string, unknown>)?.count || 0)
      : 0;
    const nextCount = current + 1;
    tx.set(
      counterRef,
      {
        date_key: dateKey,
        count: nextCount,
        last_updated: Timestamp.now(),
      },
      { merge: true }
    );
    return nextCount;
  });

  return formatOrderNumber(dateKey, next);
}

/**
 * Pick the best display string for an order. Prefers the friendly
 * `order_number` we now stamp on every new order, falls back to a
 * truncated Firestore doc ID for legacy orders so old confirmation
 * pages don't crash.
 */
export function pickDisplayOrderId(
  orderNumber: string | null | undefined,
  orderDocId: string
): string {
  const friendly = String(orderNumber || "").trim();
  if (friendly) return friendly;
  return orderDocId.slice(0, 10);
}
