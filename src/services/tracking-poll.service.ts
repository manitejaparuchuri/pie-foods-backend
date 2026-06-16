import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { isDelhiveryConfigured, trackShipment } from "./delhivery.service";
import {
  notifyCustomerOrderDelivered,
  notifyCustomerOrderOutForDelivery,
} from "./order-notifications.service";

/* ===================================================================
   Tracking Poller
   ===================================================================
   For every order currently in SHIPPED / OUT_FOR_DELIVERY, hit Delhivery
   to get the latest scan, update the order doc, and fire status-change
   emails when the shipment moves to "Out for delivery" or "Delivered".

   Triggered by an HTTP cron endpoint (so any external scheduler — cron-
   job.org, GitHub Actions, Railway cron — can run it on a schedule).
   =================================================================== */

const ordersCollection = firestore.collection("orders");

/** Internal canonical statuses that count as "in transit". */
const IN_FLIGHT_STATUSES = new Set([
  "SHIPPED",
  "OUT_FOR_DELIVERY",
]);

/**
 * Map a free-form Delhivery tracking status string to our internal canonical
 * order status. Returns null when we shouldn't change the order status.
 */
function mapDelhiveryStatusToInternal(
  raw: string | null | undefined
): "OUT_FOR_DELIVERY" | "DELIVERED" | "RETURNED" | "SHIPPED" | null {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return null;

  // Delivered
  if (/\bdelivered\b/.test(text)) return "DELIVERED";
  // Out for delivery
  if (
    /out for delivery|ofd\b|out-for-delivery|with delivery agent|with field exec/i.test(
      raw || ""
    )
  ) {
    return "OUT_FOR_DELIVERY";
  }
  // RTO / Returned
  if (/\breturn\b|\brto\b|undelivered|cancelled/i.test(raw || "")) {
    return "RETURNED";
  }
  // In-transit / dispatched
  if (/in transit|dispatched|reached|manifested|picked|shipped/i.test(raw || "")) {
    return "SHIPPED";
  }
  return null;
}

export interface PollResult {
  scanned: number;
  updated: number;
  delivered: number;
  outForDelivery: number;
  errors: number;
  details: Array<{
    orderId: string;
    waybill: string;
    oldStatus: string;
    newStatus: string | null;
    trackingStatus: string | null;
  }>;
}

/**
 * Single poll pass: iterates all in-flight orders, refreshes their Delhivery
 * tracking, and fires status-change emails. Safe to call repeatedly — it's
 * idempotent (won't re-send emails for status changes it's already processed).
 */
export async function pollInFlightOrders(): Promise<PollResult> {
  const result: PollResult = {
    scanned: 0,
    updated: 0,
    delivered: 0,
    outForDelivery: 0,
    errors: 0,
    details: [],
  };

  if (!isDelhiveryConfigured()) {
    console.warn("pollInFlightOrders: Delhivery is not configured, skipping");
    return result;
  }

  // Pull every SHIPPED/OUT_FOR_DELIVERY order. We do a single-field equality
  // query per status to avoid composite indexes; combine in memory.
  const [shippedSnap, ofdSnap] = await Promise.all([
    ordersCollection.where("status", "==", "SHIPPED").limit(500).get(),
    ordersCollection.where("status", "==", "OUT_FOR_DELIVERY").limit(500).get(),
  ]);

  const docs = [...shippedSnap.docs, ...ofdSnap.docs].filter((d) => {
    const data = d.data();
    return Boolean(data?.tracking_waybill);
  });

  for (const doc of docs) {
    result.scanned++;
    const data = doc.data() as Record<string, unknown>;
    const waybill = String(data.tracking_waybill || "");
    const oldStatus = String(data.status || "");

    try {
      const live = await trackShipment(waybill);
      const liveStatusText = String(live.currentStatus || "");
      const mapped = mapDelhiveryStatusToInternal(liveStatusText);

      // Persist latest tracking snapshot
      const updates: Record<string, unknown> = {
        tracking_status: liveStatusText || null,
        tracking_last_polled_at: Timestamp.now(),
        tracking_last_location: live.scans?.[0]?.location || null,
        tracking_expected_delivery: live.expectedDeliveryDate || null,
        updated_at: Timestamp.now(),
      };

      const newStatus = mapped && mapped !== oldStatus ? mapped : null;

      // Fire status-change side-effects only when transitioning to a new state
      if (newStatus === "OUT_FOR_DELIVERY" && oldStatus !== "OUT_FOR_DELIVERY") {
        updates.status = "OUT_FOR_DELIVERY";
        updates.out_for_delivery_at = Timestamp.now();
        result.outForDelivery++;
        // Best-effort email; never throws
        notifyCustomerOrderOutForDelivery(doc.id).catch((err) =>
          console.error("OFD notify failed:", err)
        );
      } else if (newStatus === "DELIVERED" && oldStatus !== "DELIVERED") {
        updates.status = "DELIVERED";
        updates.delivered_at = Timestamp.now();
        result.delivered++;
        notifyCustomerOrderDelivered(doc.id).catch((err) =>
          console.error("delivered notify failed:", err)
        );
      } else if (newStatus === "RETURNED" && oldStatus !== "RETURNED") {
        updates.status = "RETURNED";
        updates.returned_at = Timestamp.now();
      }

      await doc.ref.update(updates);
      result.updated++;
      result.details.push({
        orderId: doc.id,
        waybill,
        oldStatus,
        newStatus: newStatus,
        trackingStatus: liveStatusText,
      });
    } catch (err: any) {
      result.errors++;
      console.error(
        `pollInFlightOrders: failed for order ${doc.id} (${waybill}):`,
        err?.message || err
      );
      result.details.push({
        orderId: doc.id,
        waybill,
        oldStatus,
        newStatus: null,
        trackingStatus: null,
      });
    }
  }

  return result;
}

export { IN_FLIGHT_STATUSES };
