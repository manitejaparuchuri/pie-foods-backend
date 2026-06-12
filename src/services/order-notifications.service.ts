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

    const [addressRaw, user] = await Promise.all([
      loadAddress(uid, shippingId),
      loadUserEmail(uid),
    ]);

    const orderDateTs = order.order_date as Timestamp | undefined;

    await sendOrderReceivedEmailToAdmin({
      orderId,
      totalAmount: Number(order.total_amount) || 0,
      subtotalAmount: Number(order.subtotal_amount) || 0,
      couponDiscountAmount: Number(order.coupon_discount_amount) || 0,
      paymentMethod: String(order.payment_method || "RAZORPAY"),
      items: toEmailItems(order.items),
      customerEmail: user.email || undefined,
      orderDate: orderDateTs ? orderDateTs.toDate() : new Date(),
      address: addressRaw
        ? {
            name: String(addressRaw.name || user.name || ""),
            phone: String(addressRaw.phone || ""),
            address: String(addressRaw.address || ""),
            city: String(addressRaw.city || ""),
            state: String(addressRaw.state || ""),
            postal_code: String(addressRaw.postal_code || ""),
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
    const user = await loadUserEmail(uid);

    if (!user.email) {
      console.warn("notifyCustomerOrderShipped: no customer email", orderId);
      return;
    }

    await sendOrderShippedEmailToCustomer({
      orderId,
      customerEmail: user.email,
      customerName: user.name || undefined,
      waybill,
      items: toEmailItems(order.items),
      totalAmount: Number(order.total_amount) || 0,
    });
  } catch (err) {
    console.error("notifyCustomerOrderShipped error:", err);
  }
}
