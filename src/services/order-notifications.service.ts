import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import {
  sendOrderReceivedEmailToAdmin,
  sendOrderShippedEmailToCustomer,
} from "./email.service";

/* ===================================================================
   Order Notifications
   ===================================================================
   Loads order + address + user details from Firestore and fires the
   appropriate email. Every helper here is best-effort: it logs but
   never throws, so a failed notification cannot roll back a paid
   order or a shipped order.
   =================================================================== */

const ordersCollection = firestore.collection("orders");
const usersCollection = firestore.collection("users");

interface RawOrderItem {
  product_id?: number;
  name?: string;
  quantity?: number;
  price?: number;
  line_total?: number;
}

function toEmailItems(raw: unknown): Array<{
  name: string;
  quantity: number;
  price: number;
  lineTotal: number;
}> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: RawOrderItem) => ({
    name: String(item.name || "Product"),
    quantity: Number(item.quantity) || 0,
    price: Number(item.price) || 0,
    lineTotal:
      Number(item.line_total) ||
      Number(item.price) * Number(item.quantity) ||
      0,
  }));
}

async function loadAddress(
  uid: string,
  shippingId: string
): Promise<Record<string, unknown> | null> {
  if (!uid || !shippingId) return null;
  try {
    const snap = await usersCollection
      .doc(uid)
      .collection("addresses")
      .doc(shippingId)
      .get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  } catch (err) {
    console.error("loadAddress error:", err);
    return null;
  }
}

async function loadUserEmail(uid: string): Promise<{
  email: string;
  name: string;
}> {
  if (!uid) return { email: "", name: "" };
  try {
    const snap = await usersCollection.doc(uid).get();
    if (!snap.exists) return { email: "", name: "" };
    const data = snap.data() as Record<string, unknown>;
    return {
      email: String(data.email || data.user_email || ""),
      name: String(data.name || data.display_name || data.full_name || ""),
    };
  } catch (err) {
    console.error("loadUserEmail error:", err);
    return { email: "", name: "" };
  }
}

/**
 * Notify the business inbox that a paid order has just landed.
 * Safe to call from inside a webhook handler — never throws.
 */
export async function notifyAdminOrderReceived(orderId: string): Promise<void> {
  try {
    const snap = await ordersCollection.doc(orderId).get();
    if (!snap.exists) return;

    const order = snap.data() as Record<string, unknown>;
    const uid = String(order.user_id || "");
    const shippingId = String(order.shipping_id || "");

    // Don't re-send if already notified
    if (order.admin_notified_at) return;

    // Guest orders carry customer email + inline shipping address on the doc.
    // Logged-in orders look up the user record + address subcollection.
    const isGuest = Boolean(order.is_guest) || !uid;

    let customerEmail = "";
    let customerName = "";
    let address: Record<string, unknown> | null = null;

    if (isGuest) {
      customerEmail = String(order.customer_email || "");
      customerName = String(order.customer_name || "");
      address = (order.shipping_address as Record<string, unknown>) || null;
    } else {
      const [addressRaw, user] = await Promise.all([
        loadAddress(uid, shippingId),
        loadUserEmail(uid),
      ]);
      customerEmail = user.email || "";
      customerName = user.name || "";
      address = addressRaw;
    }

    const orderDateTs = order.order_date as Timestamp | undefined;

    await sendOrderReceivedEmailToAdmin({
      orderId,
      totalAmount: Number(order.total_amount) || 0,
      subtotalAmount: Number(order.subtotal_amount) || 0,
      couponDiscountAmount: Number(order.coupon_discount_amount) || 0,
      paymentMethod: String(order.payment_method || "RAZORPAY"),
      items: toEmailItems(order.items),
      customerEmail: customerEmail || undefined,
      orderDate: orderDateTs ? orderDateTs.toDate() : new Date(),
      address: address
        ? {
            name: String(address.name || customerName || ""),
            phone: String(address.phone || order.customer_phone || ""),
            address: String(address.address || ""),
            city: String(address.city || ""),
            state: String(address.state || ""),
            postal_code: String(address.postal_code || ""),
          }
        : undefined,
    });

    // Mark as notified so duplicate webhooks don't re-spam the admin
    await ordersCollection.doc(orderId).update({
      admin_notified_at: Timestamp.now(),
    });
  } catch (err) {
    console.error("notifyAdminOrderReceived error:", err);
  }
}

/**
 * Notify the customer that their order has been shipped.
 * Called from the ship-order endpoint after Delhivery accepts the shipment.
 */
export async function notifyCustomerOrderShipped(
  orderId: string,
  waybill: string
): Promise<void> {
  try {
    const snap = await ordersCollection.doc(orderId).get();
    if (!snap.exists) return;

    const order = snap.data() as Record<string, unknown>;
    const uid = String(order.user_id || "");
    const isGuest = Boolean(order.is_guest) || !uid;

    let customerEmail = "";
    let customerName = "";
    if (isGuest) {
      customerEmail = String(order.customer_email || "");
      customerName = String(order.customer_name || "");
    } else {
      const user = await loadUserEmail(uid);
      customerEmail = user.email;
      customerName = user.name;
    }

    if (!customerEmail) {
      console.warn("notifyCustomerOrderShipped: no customer email", orderId);
      return;
    }

    // Build a "view your order" URL. Guests need the access token to load it.
    const siteUrl = String(
      process.env.SITE_BASE_URL || "https://www.piefoods.com"
    ).replace(/\/+$/, "");
    const guestToken = isGuest ? String(order.guest_access_token || "") : "";
    const trackingUrl = isGuest && guestToken
      ? `${siteUrl}/order-confirmation/${encodeURIComponent(orderId)}?token=${encodeURIComponent(guestToken)}`
      : undefined;

    await sendOrderShippedEmailToCustomer({
      orderId,
      customerEmail,
      customerName: customerName || undefined,
      waybill,
      trackingUrl,
      items: toEmailItems(order.items),
      totalAmount: Number(order.total_amount) || 0,
    });
  } catch (err) {
    console.error("notifyCustomerOrderShipped error:", err);
  }
}
