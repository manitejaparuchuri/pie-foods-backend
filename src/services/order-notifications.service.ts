import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import {
  sendOrderConfirmedEmailToCustomer,
  sendOrderDeliveredEmail,
  sendOrderOutForDeliveryEmail,
  sendOrderReceivedEmailToAdmin,
  sendOrderShippedEmailToCustomer,
  sendWelcomeEmail,
} from "./email.service";
import { generateInvoicePdf, InvoiceData } from "./invoice-pdf.service";

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
      displayOrderId: order.order_number ? String(order.order_number) : undefined,
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
      displayOrderId: order.order_number ? String(order.order_number) : undefined,
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

/**
 * Shared loader for "fire customer email about a status change" — looks up the
 * order, resolves customer email + name (auth or guest), builds the tracking
 * URL, and hands everything off to the caller. Returns null when there's no
 * email to send (e.g. order missing customer info).
 */
async function loadStatusChangeContext(orderId: string): Promise<{
  data: Record<string, unknown>;
  customerEmail: string;
  customerName: string;
  waybill: string;
  trackingUrl?: string;
} | null> {
  const snap = await ordersCollection.doc(orderId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  const uid = String(data.user_id || "");
  const isGuest = Boolean(data.is_guest) || !uid;

  let customerEmail = "";
  let customerName = "";
  if (isGuest) {
    customerEmail = String(data.customer_email || "");
    customerName = String(data.customer_name || "");
  } else {
    const user = await loadUserEmail(uid);
    customerEmail = user.email;
    customerName = user.name;
  }
  if (!customerEmail) return null;

  const waybill = String(data.tracking_waybill || "");
  const siteUrl = String(
    process.env.SITE_BASE_URL || "https://www.piefoods.com"
  ).replace(/\/+$/, "");
  const guestToken = isGuest ? String(data.guest_access_token || "") : "";
  const trackingUrl =
    isGuest && guestToken
      ? `${siteUrl}/order-confirmation/${encodeURIComponent(orderId)}?token=${encodeURIComponent(guestToken)}`
      : `${siteUrl}/orders`;

  return { data, customerEmail, customerName, waybill, trackingUrl };
}

/**
 * "Your order is out for delivery!" — best-effort, never throws.
 * Marks `ofd_notified_at` after sending so the same status doesn't re-spam.
 */
export async function notifyCustomerOrderOutForDelivery(
  orderId: string
): Promise<void> {
  try {
    const ctx = await loadStatusChangeContext(orderId);
    if (!ctx) return;
    if (ctx.data.ofd_notified_at) return; // already sent

    await sendOrderOutForDeliveryEmail({
      orderId,
      displayOrderId: ctx.data.order_number
        ? String(ctx.data.order_number)
        : undefined,
      customerEmail: ctx.customerEmail,
      customerName: ctx.customerName || undefined,
      waybill: ctx.waybill || undefined,
      trackingUrl: ctx.trackingUrl,
    });

    await ordersCollection.doc(orderId).update({
      ofd_notified_at: Timestamp.now(),
    });
  } catch (err) {
    console.error("notifyCustomerOrderOutForDelivery error:", err);
  }
}

/**
 * "Your order has been delivered!" — best-effort, never throws.
 * Marks `delivered_notified_at` after sending so duplicate polls don't re-spam.
 */
export async function notifyCustomerOrderDelivered(
  orderId: string
): Promise<void> {
  try {
    const ctx = await loadStatusChangeContext(orderId);
    if (!ctx) return;
    if (ctx.data.delivered_notified_at) return; // already sent

    await sendOrderDeliveredEmail({
      orderId,
      displayOrderId: ctx.data.order_number
        ? String(ctx.data.order_number)
        : undefined,
      customerEmail: ctx.customerEmail,
      customerName: ctx.customerName || undefined,
      waybill: ctx.waybill || undefined,
      trackingUrl: ctx.trackingUrl,
    });

    await ordersCollection.doc(orderId).update({
      delivered_notified_at: Timestamp.now(),
    });
  } catch (err) {
    console.error("notifyCustomerOrderDelivered error:", err);
  }
}

/* ===================================================================
   Welcome email — fired the first time an account is created
   =================================================================== */

/**
 * Send the warm welcome email. Best-effort: logs but never throws so the
 * register/OTP-verify endpoints aren't gated on email delivery.
 */
export async function notifyCustomerWelcome(
  email: string,
  name?: string | null
): Promise<void> {
  try {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) return;
    await sendWelcomeEmail({
      customerEmail: normalizedEmail,
      customerName: name ? String(name).trim() : undefined,
    });
  } catch (err) {
    console.error("notifyCustomerWelcome error:", err);
  }
}

/* ===================================================================
   Order confirmation email + PDF invoice (customer-facing)
   =================================================================== */

/**
 * Fired when a customer's payment is verified successful. Loads the order,
 * generates a PDF invoice, and emails the customer with the invoice
 * attached. Best-effort; never throws (so a failed email cannot roll back
 * a verified payment).
 *
 * Idempotent via `customer_confirmation_notified_at` — a repeat call after
 * a successful send is a no-op.
 */
export async function notifyCustomerOrderConfirmed(orderId: string): Promise<void> {
  try {
    const snap = await ordersCollection.doc(orderId).get();
    if (!snap.exists) return;
    const order = snap.data() as Record<string, unknown>;

    // Avoid double-send when both verify-path and webhook-path try to notify.
    if (order.customer_confirmation_notified_at) return;

    const uid = String(order.user_id || "");
    const isGuest = Boolean(order.is_guest) || !uid;

    let customerEmail = "";
    let customerName = "";
    let address: Record<string, unknown> | null = null;
    let customerPhone = "";

    if (isGuest) {
      customerEmail = String(order.customer_email || "");
      customerName = String(order.customer_name || "");
      customerPhone = String(order.customer_phone || "");
      address = (order.shipping_address as Record<string, unknown>) || null;
    } else {
      const [addressRaw, user] = await Promise.all([
        loadAddress(uid, String(order.shipping_id || "")),
        loadUserEmail(uid),
      ]);
      customerEmail = user.email || "";
      customerName = user.name || "";
      address = addressRaw;
    }

    if (!customerEmail) {
      console.warn("notifyCustomerOrderConfirmed: no customer email", orderId);
      return;
    }

    const displayOrderId = order.order_number
      ? String(order.order_number)
      : orderId.slice(0, 12);
    const orderDateTs = order.order_date as Timestamp | undefined;
    const orderDate = orderDateTs ? orderDateTs.toDate() : new Date();

    const items = toEmailItems(order.items);
    const invoiceData: InvoiceData = {
      orderId,
      displayOrderId,
      orderDate,
      customerName: customerName || undefined,
      customerEmail,
      customerPhone: customerPhone || undefined,
      shippingAddress: address
        ? {
            name: String(address.name || customerName || ""),
            phone: String(address.phone || customerPhone || ""),
            address: String(address.address || ""),
            city: String(address.city || ""),
            state: String(address.state || ""),
            postal_code: String(address.postal_code || ""),
            country: String(address.country || "India"),
          }
        : undefined,
      items,
      subtotalAmount: Number(order.subtotal_amount) || 0,
      couponDiscountAmount: Number(order.coupon_discount_amount) || 0,
      shippingAmount: Number(order.shipping_amount) || 0,
      codSurchargeAmount: Number(order.cod_surcharge_amount) || 0,
      cgstAmount: Number(order.cgst_amount) || 0,
      sgstAmount: Number(order.sgst_amount) || 0,
      totalAmount: Number(order.total_amount) || 0,
      paymentMethod: String(order.payment_method || "RAZORPAY"),
    };

    // Build the PDF in-process; if it fails, fall back to sending the email
    // without the attachment rather than dropping the whole confirmation.
    let invoicePdf: Buffer | undefined;
    try {
      invoicePdf = await generateInvoicePdf(invoiceData);
    } catch (pdfErr) {
      console.error("Invoice PDF generation failed:", pdfErr);
    }

    await sendOrderConfirmedEmailToCustomer({
      orderId,
      displayOrderId,
      customerEmail,
      customerName: customerName || undefined,
      totalAmount: invoiceData.totalAmount,
      paymentMethod: invoiceData.paymentMethod,
      items,
      invoicePdf,
    });

    await ordersCollection.doc(orderId).update({
      customer_confirmation_notified_at: Timestamp.now(),
    });
  } catch (err) {
    console.error("notifyCustomerOrderConfirmed error:", err);
  }
}
