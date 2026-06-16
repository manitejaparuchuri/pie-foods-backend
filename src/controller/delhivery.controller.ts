import { Request, Response } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { AuthRequest } from "../middlewares/auth";
import {
  generateWaybill,
  createShipment,
  trackShipment,
  fetchShippingLabelUrl,
  isDelhiveryConfigured,
  ShipmentPayload,
} from "../services/delhivery.service";
import { notifyCustomerOrderShipped } from "../services/order-notifications.service";

const ordersCollection = firestore.collection("orders");
const usersCollection = firestore.collection("users");

/* ============================ ADMIN: LIST ALL ORDERS ============================ */

export const getAdminOrders = async (_req: Request, res: Response) => {
  try {
    const snap = await ordersCollection
      .orderBy("order_date", "desc")
      .limit(200)
      .get();

    // Collect unique (uid, shippingId) and uid sets so we can batch-load
    // addresses and user records in parallel rather than per order.
    const userIds = new Set<string>();
    const addressKeys = new Set<string>(); // "uid::addrId"
    snap.docs.forEach((doc) => {
      const d = doc.data() as Record<string, unknown>;
      const uid = String(d.user_id || "");
      const sid = String(d.shipping_id || "");
      if (uid) userIds.add(uid);
      if (uid && sid) addressKeys.add(`${uid}::${sid}`);
    });

    const userMap = new Map<string, { email: string; name: string }>();
    const addressMap = new Map<string, Record<string, unknown>>();

    await Promise.all([
      ...Array.from(userIds).map(async (uid) => {
        try {
          const u = await usersCollection.doc(uid).get();
          if (u.exists) {
            const ud = u.data() as Record<string, unknown>;
            userMap.set(uid, {
              email: String(ud.email || ud.user_email || ""),
              name: String(ud.name || ud.display_name || ud.full_name || ""),
            });
          }
        } catch {
          /* ignore */
        }
      }),
      ...Array.from(addressKeys).map(async (key) => {
        const [uid, addrId] = key.split("::");
        try {
          const a = await usersCollection
            .doc(uid)
            .collection("addresses")
            .doc(addrId)
            .get();
          if (a.exists) {
            addressMap.set(key, a.data() as Record<string, unknown>);
          }
        } catch {
          /* ignore */
        }
      }),
    ]);

    const orders = snap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const orderDate = data.order_date as Timestamp | undefined;
      const updatedAt = data.updated_at as Timestamp | undefined;
      const itemsRaw = Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
        : [];
      const uid = String(data.user_id || "");
      const sid = String(data.shipping_id || "");
      const user = userMap.get(uid);
      const addr = addressMap.get(`${uid}::${sid}`);

      return {
        orderId: doc.id,
        orderNumber: data.order_number ? String(data.order_number) : null,
        status: String(data.status || ""),
        paymentMethod: String(data.payment_method || "RAZORPAY"),
        totalAmount: Number(data.total_amount) || 0,
        subtotalAmount: Number(data.subtotal_amount) || 0,
        couponCode: data.coupon_code ? String(data.coupon_code) : null,
        couponDiscountAmount: Number(data.coupon_discount_amount) || 0,
        userId: uid,
        customerEmail: user?.email || null,
        customerName: user?.name || (addr?.name ? String(addr.name) : null),
        shippingId: sid,
        shippingAddress: addr
          ? {
              name: String(addr.name || user?.name || ""),
              phone: String(addr.phone || ""),
              address: String(addr.address || ""),
              city: String(addr.city || ""),
              state: String(addr.state || ""),
              postalCode: String(addr.postal_code || ""),
              country: String(addr.country || "India"),
            }
          : null,
        trackingWaybill: data.tracking_waybill
          ? String(data.tracking_waybill)
          : null,
        trackingStatus: data.tracking_status
          ? String(data.tracking_status)
          : null,
        delhiveryStatus: data.delhivery_status
          ? String(data.delhivery_status)
          : null,
        delhiveryResponse: data.delhivery_response
          ? String(data.delhivery_response)
          : null,
        shippedAt: data.shipped_at
          ? (data.shipped_at as Timestamp).toDate().toISOString()
          : null,
        deliveredAt: data.delivered_at
          ? (data.delivered_at as Timestamp).toDate().toISOString()
          : null,
        orderDate: orderDate ? orderDate.toDate().toISOString() : null,
        updatedAt: updatedAt ? updatedAt.toDate().toISOString() : null,
        items: itemsRaw.map((item) => ({
          productId: Number(item.product_id) || 0,
          name: String(item.name || "Product"),
          imageUrl: (item.image_url as string) || null,
          quantity: Number(item.quantity) || 0,
          price: Number(item.price) || 0,
          lineTotal: Number(item.line_total) || 0,
        })),
      };
    });

    return res.json({ orders });
  } catch (error: any) {
    console.error("ADMIN GET ORDERS ERROR:", error);
    return res.status(500).json({ message: "Failed to load orders" });
  }
};

/* ============================ ADMIN: SHIP ORDER ============================ */

const DELHIVERY_STATUS_FAILED = "MANIFEST_FAILED";
const DELHIVERY_STATUS_MANIFESTED = "MANIFESTED";

export const shipOrder = async (req: Request, res: Response) => {
  const orderId = String(req.params.id || "").trim();
  // ?retry=1 lets admin re-attempt manifestation for a previously failed order
  const isRetry = String(req.query.retry || req.body?.retry || "") === "1" ||
    req.query.retry === "true" ||
    req.body?.retry === true;

  if (!orderId) {
    return res.status(400).json({ message: "Invalid order id" });
  }

  if (!isDelhiveryConfigured()) {
    return res.status(503).json({
      message: "Delhivery is not configured. Set DELHIVERY_API_TOKEN.",
    });
  }

  try {
    // Load the order
    const orderSnap = await ordersCollection.doc(orderId).get();
    if (!orderSnap.exists) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = orderSnap.data() as Record<string, unknown>;
    const status = String(order.status || "");
    const existingWaybill = order.tracking_waybill
      ? String(order.tracking_waybill)
      : "";
    const delhiveryStatus = String(order.delhivery_status || "");
    const previouslyFailed = delhiveryStatus === DELHIVERY_STATUS_FAILED;

    // Decide whether this is a fresh ship or a retry of a failed one
    const allowRetry = isRetry && existingWaybill && (previouslyFailed || status === "PAID");

    if (existingWaybill && !allowRetry) {
      // Already manifested successfully — nothing to do
      if (delhiveryStatus === DELHIVERY_STATUS_MANIFESTED || status === "SHIPPED") {
        return res.status(400).json({
          message: "Order already shipped",
          waybill: existingWaybill,
        });
      }
    }

    // Status check: PAID/PROCESSING for fresh ship, also allow retry from any non-final state
    if (!allowRetry && status !== "PAID" && status !== "PROCESSING") {
      return res.status(400).json({
        message: `Cannot ship an order with status "${status}". Order must be PAID or PROCESSING.`,
      });
    }

    // Load shipping address
    const uid = String(order.user_id || "");
    const shippingId = String(order.shipping_id || "");

    let address: Record<string, unknown> = {};
    if (uid && shippingId) {
      const addrSnap = await usersCollection
        .doc(uid)
        .collection("addresses")
        .doc(shippingId)
        .get();
      if (addrSnap.exists) {
        address = addrSnap.data() as Record<string, unknown>;
      }
    }

    // Customer name fallbacks: address.name → user.name → "Customer"
    let customerName = String(address.name || "").trim();
    if (!customerName && uid) {
      try {
        const u = await usersCollection.doc(uid).get();
        if (u.exists) {
          const ud = u.data() as Record<string, unknown>;
          customerName = String(ud.name || ud.display_name || ud.full_name || "").trim();
        }
      } catch {
        /* ignore */
      }
    }
    if (!customerName) customerName = "Customer";

    // Validate we have enough address fields for Delhivery
    const missingFields: string[] = [];
    if (!String(address.address || "").trim()) missingFields.push("address");
    if (!String(address.city || "").trim()) missingFields.push("city");
    if (!String(address.state || "").trim()) missingFields.push("state");
    if (!String(address.postal_code || "").trim()) missingFields.push("pincode");
    if (!String(address.phone || "").trim()) missingFields.push("phone");
    if (missingFields.length) {
      return res.status(400).json({
        message: `Shipping address is incomplete. Missing: ${missingFields.join(", ")}`,
      });
    }

    // Build product description from items
    const items = Array.isArray(order.items)
      ? (order.items as Array<Record<string, unknown>>)
      : [];
    const productDesc = items
      .map((i) => `${i.name || "Item"} x${i.quantity || 1}`)
      .join(", ");
    const totalQty = items.reduce(
      (sum, i) => sum + (Number(i.quantity) || 1),
      0
    );
    const paymentMethod = String(order.payment_method || "RAZORPAY");

    // Step 1: Get a waybill (reuse on retry, fresh on first ship)
    let waybill: string = existingWaybill;
    if (!waybill) {
      try {
        waybill = await generateWaybill();
      } catch (wbError: any) {
        console.error("WAYBILL GENERATION FAILED:", wbError.message);
        return res.status(502).json({
          message: "Could not generate waybill from Delhivery",
          error: String(wbError?.message || wbError),
        });
      }
    }

    // Step 2: Create shipment on Delhivery (manifestation)
    const shipmentPayload: ShipmentPayload = {
      waybill,
      orderId,
      name: customerName,
      phone: String(address.phone || ""),
      address: String(address.address || ""),
      city: String(address.city || ""),
      state: String(address.state || ""),
      pincode: String(address.postal_code || ""),
      country: String(address.country || "India"),
      paymentMode: paymentMethod === "COD" ? "COD" : "Prepaid",
      totalAmount: Number(order.total_amount) || 0,
      codAmount: paymentMethod === "COD" ? Number(order.total_amount) || 0 : 0,
      productDescription: productDesc || "PIE Foods Products",
      weight: Math.max(totalQty * 200, 100), // ~200g per item, min 100g
      quantity: totalQty,
    };

    let manifestSucceeded = false;
    let manifestError = "";
    let shipmentResult: { success: boolean; waybill: string; remark?: string } = {
      success: false,
      waybill,
    };

    try {
      shipmentResult = await createShipment(shipmentPayload);
      manifestSucceeded = shipmentResult.success !== false;
    } catch (shipError: any) {
      manifestError = String(shipError?.message || shipError);
      console.error("SHIPMENT MANIFESTATION FAILED:", manifestError);
    }

    if (!manifestSucceeded) {
      // Don't mark the order as SHIPPED. Save waybill + error so admin can retry
      // after fixing the underlying issue (e.g. wrong warehouse name, bad pincode).
      await ordersCollection.doc(orderId).update({
        tracking_waybill: waybill, // keep for retry
        delhivery_status: DELHIVERY_STATUS_FAILED,
        delhivery_response: manifestError || shipmentResult.remark || "Manifestation failed",
        updated_at: Timestamp.now(),
      });

      return res.status(502).json({
        message: "Delhivery rejected the shipment",
        error: manifestError || shipmentResult.remark || "Unknown error",
        waybill,
        canRetry: true,
      });
    }

    // Success path: mark SHIPPED, store manifest response
    const wasAlreadyShipped =
      delhiveryStatus === DELHIVERY_STATUS_MANIFESTED || status === "SHIPPED";

    await ordersCollection.doc(orderId).update({
      status: "SHIPPED",
      tracking_waybill: waybill,
      tracking_status: "Shipped",
      shipped_at: Timestamp.now(),
      delhivery_status: DELHIVERY_STATUS_MANIFESTED,
      delhivery_response: shipmentResult.remark || "Manifested",
      updated_at: Timestamp.now(),
    });

    // Fire-and-forget shipment email to customer (skip on retry of already-emailed)
    if (!wasAlreadyShipped) {
      notifyCustomerOrderShipped(orderId, waybill).catch((err) =>
        console.error("customer shipped notify failed:", err)
      );
    }

    return res.json({
      message: isRetry
        ? "Order re-shipped successfully (manifestation retried)"
        : "Order shipped successfully",
      orderId,
      waybill,
      status: "SHIPPED",
      retried: isRetry,
      delhiveryResponse: shipmentResult,
    });
  } catch (error: any) {
    console.error("SHIP ORDER ERROR:", error);
    return res.status(500).json({
      message: "Failed to ship order",
      error: String(error?.message || error),
    });
  }
};

/* ============================ ADMIN: RESET SHIPMENT ============================ */

/**
 * Reset a "phantom shipped" order — one marked SHIPPED in our DB but where the
 * Delhivery manifestation actually failed silently (before the bug fix that
 * stopped marking failed manifests as SHIPPED). Sets the order back to PAID and
 * clears the waybill so it can be freshly shipped.
 *
 * USE WITH CAUTION: only run this on orders Delhivery doesn't actually have.
 */
export const resetOrderShipping = async (req: Request, res: Response) => {
  const orderId = String(req.params.id || "").trim();
  if (!orderId) {
    return res.status(400).json({ message: "Invalid order id" });
  }

  try {
    const snap = await ordersCollection.doc(orderId).get();
    if (!snap.exists) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = snap.data() as Record<string, unknown>;
    const previousWaybill = order.tracking_waybill
      ? String(order.tracking_waybill)
      : null;

    await ordersCollection.doc(orderId).update({
      status: "PAID",
      tracking_waybill: null,
      tracking_status: null,
      delhivery_status: null,
      delhivery_response: null,
      shipped_at: null,
      updated_at: Timestamp.now(),
    });

    return res.json({
      message: "Shipping state reset. Order is back to PAID and can be re-shipped.",
      orderId,
      previousWaybill,
    });
  } catch (error: any) {
    console.error("RESET ORDER SHIPPING ERROR:", error);
    return res.status(500).json({
      message: "Failed to reset shipping",
      error: String(error?.message || error),
    });
  }
};

/* ============================ ADMIN: DELHIVERY DIAGNOSTIC ============================ */

/**
 * Diagnostic endpoint — admin can hit this anytime to verify the Delhivery
 * integration is configured correctly. It does NOT create a real shipment.
 * Just tries to generate a waybill (which validates the API token), then
 * immediately reports back the warehouse env vars as the server sees them.
 */
export const testDelhiveryConnection = async (
  _req: Request,
  res: Response
) => {
  const summary: Record<string, unknown> = {
    apiTokenConfigured: isDelhiveryConfigured(),
    baseUrl: String(process.env.DELHIVERY_BASE_URL || "default"),
    warehouse: {
      name: String(process.env.DELHIVERY_WAREHOUSE_NAME || ""),
      address: String(process.env.DELHIVERY_WAREHOUSE_ADDRESS || ""),
      city: String(process.env.DELHIVERY_WAREHOUSE_CITY || ""),
      state: String(process.env.DELHIVERY_WAREHOUSE_STATE || ""),
      pin: String(process.env.DELHIVERY_WAREHOUSE_PIN || ""),
      phone: String(process.env.DELHIVERY_WAREHOUSE_PHONE || ""),
      country: String(process.env.DELHIVERY_WAREHOUSE_COUNTRY || ""),
    },
  };

  if (!isDelhiveryConfigured()) {
    return res.status(503).json({
      ok: false,
      ...summary,
      error: "DELHIVERY_API_TOKEN is not set in environment",
    });
  }

  // Validate the warehouse env vars are all non-empty
  const wh = summary.warehouse as Record<string, string>;
  const missing = Object.entries(wh)
    .filter(([_, v]) => !v.trim())
    .map(([k]) => k);
  if (missing.length) {
    return res.status(400).json({
      ok: false,
      ...summary,
      error: `Warehouse env vars missing: ${missing.join(", ")}`,
    });
  }

  // Try generating a waybill — this validates the API token + base URL
  try {
    const waybill = await generateWaybill();
    return res.json({
      ok: true,
      ...summary,
      waybillTest: {
        success: true,
        sampleWaybill: waybill,
      },
      note: "Waybill generation works. Warehouse env vars look populated. To verify the warehouse NAME is correct, you must do an actual manifestation (ship a real order). Generated waybill above is unused — it will expire on Delhivery's side.",
    });
  } catch (err: any) {
    return res.status(502).json({
      ok: false,
      ...summary,
      waybillTest: {
        success: false,
        error: String(err?.message || err),
      },
      note: "Waybill generation failed. Most common causes: wrong API token, wrong base URL, or token revoked.",
    });
  }
};

/* ============================ ADMIN: GET SHIPPING LABEL ============================ */

export const getOrderLabel = async (req: Request, res: Response) => {
  const orderId = String(req.params.id || "").trim();
  if (!orderId) {
    return res.status(400).json({ message: "Invalid order id" });
  }

  if (!isDelhiveryConfigured()) {
    return res.status(503).json({ message: "Delhivery is not configured" });
  }

  try {
    const snap = await ordersCollection.doc(orderId).get();
    if (!snap.exists) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = snap.data() as Record<string, unknown>;
    const waybill = order.tracking_waybill ? String(order.tracking_waybill) : "";
    if (!waybill) {
      return res
        .status(400)
        .json({ message: "Order has not been shipped yet (no waybill)" });
    }

    const url = await fetchShippingLabelUrl(waybill);
    return res.json({ orderId, waybill, labelUrl: url });
  } catch (error: any) {
    console.error("GET LABEL ERROR:", error);
    return res
      .status(500)
      .json({ message: error?.message || "Failed to fetch shipping label" });
  }
};

/* ============================ ADMIN: UPDATE ORDER STATUS ============================ */

const VALID_STATUSES = new Set([
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
]);

export const updateOrderStatus = async (req: Request, res: Response) => {
  const orderId = String(req.params.id || "").trim();
  const newStatus = String(req.body?.status || "").trim().toUpperCase();

  if (!orderId) {
    return res.status(400).json({ message: "Invalid order id" });
  }

  if (!VALID_STATUSES.has(newStatus)) {
    return res.status(400).json({
      message: `Invalid status. Must be one of: ${Array.from(VALID_STATUSES).join(", ")}`,
    });
  }

  try {
    const orderSnap = await ordersCollection.doc(orderId).get();
    if (!orderSnap.exists) {
      return res.status(404).json({ message: "Order not found" });
    }

    const updateData: Record<string, unknown> = {
      status: newStatus,
      tracking_status: newStatus,
      updated_at: Timestamp.now(),
    };

    if (newStatus === "DELIVERED") {
      updateData.delivered_at = Timestamp.now();
    }

    await ordersCollection.doc(orderId).update(updateData);

    return res.json({
      message: `Order status updated to ${newStatus}`,
      orderId,
      status: newStatus,
    });
  } catch (error: any) {
    console.error("UPDATE ORDER STATUS ERROR:", error);
    return res.status(500).json({ message: "Failed to update order status" });
  }
};

/* ============================ CUSTOMER: TRACK ORDER ============================ */

export const trackOrder = async (req: AuthRequest, res: Response) => {
  const uid = req.user?.uid;
  const role = req.user?.role;
  const orderId = String(req.params.id || "").trim();

  if (!uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!orderId) {
    return res.status(400).json({ message: "Invalid order id" });
  }

  try {
    const orderSnap = await ordersCollection.doc(orderId).get();
    if (!orderSnap.exists) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = orderSnap.data() as Record<string, unknown>;

    // Only order owner or admin can track
    if (String(order.user_id || "") !== uid && role !== "admin") {
      return res.status(404).json({ message: "Order not found" });
    }

    const waybill = order.tracking_waybill
      ? String(order.tracking_waybill)
      : null;

    // Base tracking info from our database
    const trackingInfo: Record<string, unknown> = {
      orderId,
      status: String(order.status || ""),
      trackingWaybill: waybill,
      trackingStatus: order.tracking_status
        ? String(order.tracking_status)
        : null,
      shippedAt: order.shipped_at
        ? (order.shipped_at as Timestamp).toDate().toISOString()
        : null,
      deliveredAt: order.delivered_at
        ? (order.delivered_at as Timestamp).toDate().toISOString()
        : null,
      liveTracking: null,
    };

    // If waybill exists and Delhivery is configured, fetch live tracking
    if (waybill && isDelhiveryConfigured()) {
      try {
        const liveTracking = await trackShipment(waybill);
        trackingInfo.liveTracking = liveTracking;

        // Optionally update the tracking status in our DB
        if (
          liveTracking.currentStatus &&
          liveTracking.currentStatus !== "Unknown"
        ) {
          await ordersCollection.doc(orderId).update({
            tracking_status: liveTracking.currentStatus,
            updated_at: Timestamp.now(),
          });
          trackingInfo.trackingStatus = liveTracking.currentStatus;
        }
      } catch (trackError: any) {
        console.error("LIVE TRACKING FETCH ERROR:", trackError.message);
        // Return what we have from our DB even if Delhivery is unreachable
      }
    }

    return res.json(trackingInfo);
  } catch (error: any) {
    console.error("TRACK ORDER ERROR:", error);
    return res.status(500).json({ message: "Failed to load tracking info" });
  }
};
