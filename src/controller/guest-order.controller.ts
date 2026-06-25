import { Request, Response } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import {
  createGuestOrder,
  GuestOrderInput,
  loadGuestOrderForAccess,
  validateGuestOrderInput,
} from "../services/guest-order.service";
import { isDelhiveryConfigured, trackShipment } from "../services/delhivery.service";

const ordersCollection = firestore.collection("orders");

const GUEST_MAX_ORDERS_PER_EMAIL_PER_DAY = 20;

/**
 * Per-email rate limit. Legitimate customers almost never place more than a
 * handful of orders per day; the cap is generous to avoid friction but still
 * stops the same email being used as a spam funnel.
 *
 * Implementation note: We use a single-field equality on customer_email to
 * avoid requiring a composite Firestore index. The 24-hour window filter is
 * applied in memory. For real customers (lifetime orders < 200) this is
 * cheap and self-contained — no Firestore index setup needed.
 */
async function isGuestEmailRateLimited(
  email: string
): Promise<{ limited: true; count: number } | { limited: false; count: number }> {
  const normalized = email.trim().toLowerCase();
  const snap = await ordersCollection
    .where("customer_email", "==", normalized)
    .limit(200)
    .get();

  const sinceMillis = Date.now() - 24 * 60 * 60 * 1000;
  let recentCount = 0;
  for (const doc of snap.docs) {
    const ts = doc.data().order_date as Timestamp | undefined;
    if (ts && ts.toMillis() >= sinceMillis) {
      recentCount++;
      if (recentCount >= GUEST_MAX_ORDERS_PER_EMAIL_PER_DAY) {
        return { limited: true, count: recentCount };
      }
    }
  }
  return { limited: false, count: recentCount };
}

/* ============================ POST /api/orders/guest ============================ */

export const createGuestOrderController = async (
  req: Request,
  res: Response
) => {
  try {
    const validation = validateGuestOrderInput(req.body);
    if (!validation.ok) {
      return res.status(400).json({ message: validation.error });
    }

    // Per-email rate limit — circuit breaker against abuse
    const limit = await isGuestEmailRateLimited(String(req.body.email).trim().toLowerCase());
    if (limit.limited) {
      return res.status(429).json({
        message:
          "Too many recent orders for this email. Please try again tomorrow, or sign in to continue.",
      });
    }

    const result = await createGuestOrder(req.body as GuestOrderInput);

    return res.status(201).json({
      message: "Guest order created",
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      guestAccessToken: result.guestAccessToken,
      totalAmount: result.totalAmount,
      subtotalAmount: result.subtotalAmount,
      paymentMethod: result.paymentMethod,
      status: result.status,
    });
  } catch (error: any) {
    console.error("CREATE GUEST ORDER ERROR:", error?.message || error);
    const safe = new Set([
      "Cart is empty",
      "None of the items in the cart are available",
      "Order amount must be greater than zero",
    ]);
    const message = String(error?.message || "");
    if (safe.has(message)) {
      return res.status(400).json({ message });
    }
    if (
      message.startsWith("Insufficient stock") ||
      message.startsWith("Product no longer available")
    ) {
      return res.status(409).json({
        message: "Sorry, an item just went out of stock. Please review your cart.",
      });
    }
    return res.status(500).json({ message: "Failed to create guest order" });
  }
};

/* ============================ GET /api/orders/guest/:id?token=... ============================ */

export const getGuestOrderController = async (req: Request, res: Response) => {
  try {
    const orderId = String(req.params.id || "").trim();
    const token = String(req.query.token || req.headers["x-guest-token"] || "").trim();

    const { data } = await loadGuestOrderForAccess(orderId, token);

    const orderDate = data.order_date as Timestamp | undefined;
    const shippedAt = data.shipped_at as Timestamp | undefined;
    const deliveredAt = data.delivered_at as Timestamp | undefined;
    const outForDeliveryAt = data.out_for_delivery_at as Timestamp | undefined;
    const itemsRaw = Array.isArray(data.items)
      ? (data.items as Array<Record<string, unknown>>)
      : [];

    const shipping = (data.shipping_address as Record<string, unknown>) || null;

    // Live tracking: when the order has a waybill and Delhivery is configured,
    // fetch the latest scan history so the guest's confirmation page can
    // render the same timeline a logged-in customer would see.
    const waybill = data.tracking_waybill ? String(data.tracking_waybill) : null;
    let liveTracking: Awaited<ReturnType<typeof trackShipment>> | null = null;
    if (waybill && isDelhiveryConfigured()) {
      try {
        liveTracking = await trackShipment(waybill);
      } catch (trackErr) {
        // Tracking failures must not break the order page — fall back to
        // the snapshot stored on the order doc.
        console.error("Guest live-tracking fetch failed:", trackErr);
      }
    }

    return res.json({
      orderId,
      orderNumber: data.order_number ? String(data.order_number) : null,
      status: String(data.status || ""),
      paymentMethod: String(data.payment_method || "RAZORPAY"),
      providerOrderId: data.provider_order_id ? String(data.provider_order_id) : null,
      totalAmount: Number(data.total_amount) || 0,
      subtotalAmount: Number(data.subtotal_amount) || 0,
      couponCode: data.coupon_code ? String(data.coupon_code) : null,
      couponDiscountAmount: Number(data.coupon_discount_amount) || 0,
      customerName: data.customer_name ? String(data.customer_name) : null,
      customerEmail: data.customer_email ? String(data.customer_email) : null,
      customerPhone: data.customer_phone ? String(data.customer_phone) : null,
      shippingAddress: shipping
        ? {
            name: String(shipping.name || ""),
            phone: String(shipping.phone || ""),
            address: String(shipping.address || ""),
            city: String(shipping.city || ""),
            state: String(shipping.state || ""),
            postalCode: String(shipping.postal_code || ""),
            country: String(shipping.country || "India"),
          }
        : null,
      trackingWaybill: data.tracking_waybill ? String(data.tracking_waybill) : null,
      trackingStatus: data.tracking_status ? String(data.tracking_status) : null,
      trackingLastLocation: data.tracking_last_location
        ? String(data.tracking_last_location)
        : null,
      trackingExpectedDelivery: data.tracking_expected_delivery
        ? String(data.tracking_expected_delivery)
        : null,
      liveTracking,
      orderDate: orderDate ? orderDate.toDate().toISOString() : null,
      shippedAt: shippedAt ? shippedAt.toDate().toISOString() : null,
      outForDeliveryAt: outForDeliveryAt
        ? outForDeliveryAt.toDate().toISOString()
        : null,
      deliveredAt: deliveredAt ? deliveredAt.toDate().toISOString() : null,
      items: itemsRaw.map((item) => ({
        productId: Number(item.product_id) || 0,
        name: String(item.name || "Product"),
        imageUrl: (item.image_url as string) || null,
        quantity: Number(item.quantity) || 0,
        price: Number(item.price) || 0,
        lineTotal: Number(item.line_total) || 0,
      })),
    });
  } catch (error: any) {
    const message = String(error?.message || "");
    if (
      message === "Order id and access token are required" ||
      message === "Order not found"
    ) {
      return res.status(404).json({ message: "Order not found" });
    }
    console.error("GET GUEST ORDER ERROR:", error);
    return res.status(500).json({ message: "Failed to load order" });
  }
};

/**
 * Auto-mark guest order's user_id when an OTP-verified user matches email.
 * Uses a single-field equality (no composite index needed) and filters
 * unlinked orders in memory.
 */
export async function linkGuestOrdersToUser(
  email: string,
  uid: string
): Promise<number> {
  if (!email || !uid) return 0;
  const normalizedEmail = email.trim().toLowerCase();

  const snap = await ordersCollection
    .where("customer_email", "==", normalizedEmail)
    .limit(500)
    .get();

  if (snap.empty) return 0;

  // Only update orders that aren't already linked to a user
  const unlinked = snap.docs.filter((doc) => {
    const userId = doc.data().user_id;
    return userId === null || userId === undefined || userId === "";
  });
  if (unlinked.length === 0) return 0;

  const batch = firestore.batch();
  unlinked.forEach((doc) => {
    batch.update(doc.ref, {
      user_id: uid,
      linked_via_otp_at: Timestamp.now(),
      updated_at: Timestamp.now(),
    });
  });
  await batch.commit();
  return unlinked.length;
}
