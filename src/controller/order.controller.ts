import { Response } from "express";
import { firestore } from "../config/firebase";
import { Timestamp } from "firebase-admin/firestore";
import OrderService from "../services/order.service";
import { AuthRequest } from "../middlewares/auth";
import { COUPON_ERRORS } from "../services/coupon.service";
import { isDelhiveryConfigured, trackShipment } from "../services/delhivery.service";

type PaymentMethod = "RAZORPAY" | "COD";

const ordersCollection = firestore.collection("orders");

export const createOrder = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { shippingId, paymentMethod: rawPaymentMethod, coupon_code, couponCode } = req.body;

    if (!shippingId) {
      return res.status(400).json({ message: "Shipping ID is required" });
    }

    const paymentMethod = String(rawPaymentMethod ?? "RAZORPAY").toUpperCase();
    if (paymentMethod !== "RAZORPAY" && paymentMethod !== "COD") {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    const result = await OrderService.createOrder(
      uid,
      String(shippingId),
      paymentMethod as PaymentMethod,
      String(coupon_code || couponCode || "").trim()
    );

    return res.status(201).json({
      message:
        paymentMethod === "COD"
          ? "COD order placed successfully"
          : "Order created successfully",
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      totalAmount: result.totalAmount,
      paymentMethod: result.paymentMethod,
      status: result.status,
      coupon: result.coupon,
    });
  } catch (error: any) {
    console.error("CREATE ORDER ERROR:", error?.message || error);

    if (
      error?.message === "Cart is empty" ||
      error?.message === "Invalid shipping address" ||
      Object.values(COUPON_ERRORS).includes(String(error?.message || ""))
    ) {
      return res.status(400).json({ message: error.message });
    }

    const stockMsg = String(error?.message || "");
    if (
      stockMsg.startsWith("Insufficient stock") ||
      stockMsg.startsWith("Product no longer available")
    ) {
      return res.status(409).json({
        message: "Sorry, an item just went out of stock. Please review your cart.",
      });
    }

    return res.status(500).json({ message: "Failed to create order" });
  }
};

export const getOrderById = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    const role = req.user?.role;
    if (!uid) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const orderId = String(req.params.id || "").trim();
    if (!orderId) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const snap = await ordersCollection.doc(orderId).get();
    if (!snap.exists) {
      return res.status(404).json({ message: "Order not found" });
    }

    const data = snap.data() as Record<string, unknown>;
    const ownerUid = String(data.user_id || "");
    if (ownerUid !== uid && role !== "admin") {
      return res.status(404).json({ message: "Order not found" });
    }

    const orderDate = data.order_date as Timestamp | undefined;
    const itemsRaw = Array.isArray(data.items)
      ? (data.items as Array<Record<string, unknown>>)
      : [];

    const shippedAt = data.shipped_at as Timestamp | undefined;
    const outForDeliveryAt = data.out_for_delivery_at as Timestamp | undefined;
    const deliveredAt = data.delivered_at as Timestamp | undefined;

    // Live tracking so the confirmation page has fresh scan history without
    // waiting for the next cron poll.
    const waybill = data.tracking_waybill ? String(data.tracking_waybill) : null;
    let liveTracking: Awaited<ReturnType<typeof trackShipment>> | null = null;
    if (waybill && isDelhiveryConfigured()) {
      try {
        liveTracking = await trackShipment(waybill);
      } catch (trackErr) {
        console.error("Logged-in live-tracking fetch failed:", trackErr);
      }
    }

    return res.status(200).json({
      orderId: snap.id,
      orderNumber: data.order_number ? String(data.order_number) : null,
      status: String(data.status || ""),
      paymentMethod: String(data.payment_method || "RAZORPAY"),
      providerOrderId: data.provider_order_id ? String(data.provider_order_id) : null,
      couponCode: data.coupon_code ? String(data.coupon_code) : null,
      subtotalAmount: Number(data.subtotal_amount) || 0,
      couponDiscountAmount: Number(data.coupon_discount_amount) || 0,
      totalAmount: Number(data.total_amount) || 0,
      finalAmount: Number(data.final_amount) || 0,
      shippingId: String(data.shipping_id || ""),
      orderDate: orderDate ? orderDate.toDate().toISOString() : null,
      trackingWaybill: waybill,
      trackingStatus: data.tracking_status ? String(data.tracking_status) : null,
      trackingLastLocation: data.tracking_last_location
        ? String(data.tracking_last_location)
        : null,
      trackingExpectedDelivery: data.tracking_expected_delivery
        ? String(data.tracking_expected_delivery)
        : null,
      liveTracking,
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
    console.error("GET ORDER BY ID ERROR:", error?.message || error);
    return res.status(500).json({ message: "Failed to load order" });
  }
};

export const getMyOrders = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const orders = await OrderService.getOrdersByUser(uid);
    return res.status(200).json(orders);
  } catch (error: any) {
    console.error("GET ORDERS ERROR:", error?.message || error);
    return res.status(500).json({ message: "Failed to load orders" });
  }
};
