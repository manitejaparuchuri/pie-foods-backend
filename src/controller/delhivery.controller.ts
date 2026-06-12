import { Request, Response } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { AuthRequest } from "../middlewares/auth";
import {
  generateWaybill,
  createShipment,
  trackShipment,
  isDelhiveryConfigured,
  ShipmentPayload,
} from "../services/delhivery.service";

const ordersCollection = firestore.collection("orders");
const usersCollection = firestore.collection("users");

/* ============================ ADMIN: LIST ALL ORDERS ============================ */

export const getAdminOrders = async (_req: Request, res: Response) => {
  try {
    const snap = await ordersCollection
      .orderBy("order_date", "desc")
      .limit(200)
      .get();

    const orders = snap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const orderDate = data.order_date as Timestamp | undefined;
      const updatedAt = data.updated_at as Timestamp | undefined;
      const itemsRaw = Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
        : [];

      return {
        orderId: doc.id,
        status: String(data.status || ""),
        paymentMethod: String(data.payment_method || "RAZORPAY"),
        totalAmount: Number(data.total_amount) || 0,
        subtotalAmount: Number(data.subtotal_amount) || 0,
        couponCode: data.coupon_code ? String(data.coupon_code) : null,
        couponDiscountAmount: Number(data.coupon_discount_amount) || 0,
        userId: String(data.user_id || ""),
        shippingId: String(data.shipping_id || ""),
        trackingWaybill: data.tracking_waybill
          ? String(data.tracking_waybill)
          : null,
        trackingStatus: data.tracking_status
          ? String(data.tracking_status)
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

export const shipOrder = async (req: Request, res: Response) => {
  const orderId = String(req.params.id || "").trim();
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

    // Only PAID or PROCESSING orders can be shipped
    if (status !== "PAID" && status !== "PROCESSING") {
      return res.status(400).json({
        message: `Cannot ship an order with status "${status}". Order must be PAID or PROCESSING.`,
      });
    }

    // Check if already shipped
    if (order.tracking_waybill) {
      return res.status(400).json({
        message: "Order already has a waybill assigned",
        waybill: String(order.tracking_waybill),
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

    // Step 1: Generate waybill
    let waybill: string;
    try {
      waybill = await generateWaybill();
    } catch (wbError: any) {
      console.error("WAYBILL GENERATION FAILED:", wbError.message);
      // Generate a local waybill as fallback
      waybill = `PIE${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      console.log("Using fallback waybill:", waybill);
    }

    // Step 2: Create shipment on Delhivery
    const shipmentPayload: ShipmentPayload = {
      waybill,
      orderId,
      name: String(address.address ? `${uid}` : "Customer"),
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
      weight: totalQty * 200, // ~200g per item estimate
      quantity: totalQty,
    };

    let shipmentResult;
    try {
      shipmentResult = await createShipment(shipmentPayload);
    } catch (shipError: any) {
      console.error("SHIPMENT CREATION FAILED:", shipError.message);
      // Still save the waybill even if Delhivery create fails
      // so admin can retry or manually manifest later
      shipmentResult = {
        success: false,
        waybill,
        remark: `Local waybill assigned. Delhivery error: ${shipError.message}`,
      };
    }

    // Step 3: Update order in Firestore
    await ordersCollection.doc(orderId).update({
      status: "SHIPPED",
      tracking_waybill: waybill,
      tracking_status: "Shipped",
      shipped_at: Timestamp.now(),
      delhivery_response: shipmentResult.remark || null,
      updated_at: Timestamp.now(),
    });

    return res.json({
      message: "Order shipped successfully",
      orderId,
      waybill,
      status: "SHIPPED",
      delhiveryResponse: shipmentResult,
    });
  } catch (error: any) {
    console.error("SHIP ORDER ERROR:", error);
    return res.status(500).json({ message: "Failed to ship order" });
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
