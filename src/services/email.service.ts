import axios from "axios";
import nodemailer from "nodemailer";

/* ===================================================================
   Generic Email Service
   ===================================================================
   Sends transactional emails via Brevo HTTP API (preferred) or falls
   back to SMTP. Never throws to the caller — email failures must not
   roll back the order/payment that triggered them.
   =================================================================== */

const getEnv = (key: string, fallback = ""): string =>
  String(process.env[key] || "").trim() || fallback;

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatIndiaTimestamp(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const yy = ist.getUTCFullYear();
  const h24 = ist.getUTCHours();
  const mins = String(ist.getUTCMinutes()).padStart(2, "0");
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = String(h24 % 12 || 12).padStart(2, "0");
  return `${dd}-${mm}-${yy} ${h12}:${mins} ${ampm} IST`;
}

async function sendViaBrevo(message: EmailMessage): Promise<boolean> {
  const apiKey = getEnv("BREVO_API_KEY");
  const fromEmail = getEnv("BREVO_FROM_EMAIL");
  const fromName = getEnv("BREVO_FROM_NAME", "PIE Foods");

  if (!apiKey || !fromEmail) return false;

  // Brevo expects attachments as { name, content } with content being base64.
  const brevoAttachments = (message.attachments || []).map((a) => ({
    name: a.filename,
    content: a.content.toString("base64"),
  }));

  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: { name: fromName, email: fromEmail },
      to: [{ email: message.to, name: message.toName || message.to }],
      replyTo: message.replyTo ? { email: message.replyTo } : undefined,
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
      attachment: brevoAttachments.length ? brevoAttachments : undefined,
    },
    {
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      timeout: 15000,
    }
  );
  return true;
}

async function sendViaSmtp(message: EmailMessage): Promise<boolean> {
  const host = getEnv("SMTP_HOST");
  const port = Number(getEnv("SMTP_PORT"));
  const user = getEnv("SMTP_USER");
  const pass = getEnv("SMTP_PASS").replace(/\s+/g, "");

  if (!host || !port || !user || !pass) return false;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    connectionTimeout: 10000,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"${getEnv("BREVO_FROM_NAME", "PIE Foods")}" <${user}>`,
    to: message.to,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: (message.attachments || []).map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });
  return true;
}

/**
 * Send an email. Tries Brevo first, then SMTP. Never throws — logs on failure.
 * Returns true if any provider accepted the email, false otherwise.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (!message.to || !message.subject) return false;

  try {
    if (await sendViaBrevo(message)) return true;
  } catch (err: any) {
    console.error("EMAIL BREVO ERROR:", err?.response?.data || err?.message);
  }

  try {
    if (await sendViaSmtp(message)) return true;
  } catch (err: any) {
    console.error("EMAIL SMTP ERROR:", err?.message);
  }

  console.warn(
    "EMAIL NOT SENT: no provider configured (need BREVO_API_KEY+BREVO_FROM_EMAIL or SMTP_HOST/PORT/USER/PASS)"
  );
  return false;
}

/* ===================================================================
   Templates
   =================================================================== */

interface OrderEmailItem {
  name: string;
  quantity: number;
  price: number;
  lineTotal: number;
}

interface OrderEmailAddress {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
}

interface OrderEmailData {
  orderId: string;
  /** Friendly order number shown to the customer/admin (e.g. PF2606120001). */
  displayOrderId?: string;
  totalAmount: number;
  subtotalAmount?: number;
  couponDiscountAmount?: number;
  paymentMethod: string;
  items: OrderEmailItem[];
  customerEmail?: string;
  address?: OrderEmailAddress;
  orderDate?: Date;
}

function inr(n: number): string {
  return `₹${(Number(n) || 0).toFixed(2)}`;
}

function buildItemsTable(items: OrderEmailItem[]): string {
  return items
    .map(
      (i) => `
      <tr>
        <td style="padding:10px;border-top:1px solid #eef2f7;font-size:14px;">${escapeHtml(
          i.name
        )}</td>
        <td style="padding:10px;border-top:1px solid #eef2f7;font-size:14px;text-align:center;">${i.quantity}</td>
        <td style="padding:10px;border-top:1px solid #eef2f7;font-size:14px;text-align:right;">${inr(
          i.price
        )}</td>
        <td style="padding:10px;border-top:1px solid #eef2f7;font-size:14px;text-align:right;font-weight:600;">${inr(
          i.lineTotal
        )}</td>
      </tr>
    `
    )
    .join("");
}

function buildAddressBlock(address?: OrderEmailAddress): string {
  if (!address) return "";
  const parts = [
    address.name,
    address.address,
    `${address.city || ""}, ${address.state || ""} ${address.postal_code || ""}`.trim(),
    address.phone ? `Phone: ${address.phone}` : "",
  ]
    .filter(Boolean)
    .map((p) => escapeHtml(String(p)));
  return parts.join("<br/>");
}

/**
 * Send an "Order Received" notification to the admin / business inbox.
 * Triggered when a customer's payment is successfully captured.
 */
export async function sendOrderReceivedEmailToAdmin(
  order: OrderEmailData
): Promise<boolean> {
  const adminEmail =
    getEnv("ORDER_NOTIFY_EMAIL") ||
    getEnv("CONTACT_TO_EMAIL", "piefoodsonline@gmail.com");

  const submittedAt = formatIndiaTimestamp(order.orderDate || new Date());
  const itemsHtml = buildItemsTable(order.items);
  const addressHtml = buildAddressBlock(order.address);
  const displayId = (order.displayOrderId || "").trim() || order.orderId.slice(0, 12);

  const subject = `New Order Received — ${displayId} (${inr(order.totalAmount)})`;

  const html = `
<div style="margin:0;padding:24px;background:#f3f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr>
      <td style="background:#2f3b2d;padding:20px 24px;color:#fff;">
        <div style="font-size:22px;font-weight:700;">PIE Foods</div>
        <div style="font-size:13px;opacity:0.95;margin-top:6px;">New Order Received</div>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 24px 6px;">
        <div style="font-size:14px;color:#6b7280;">Order Number</div>
        <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:14px;letter-spacing:0.04em;">${escapeHtml(
          displayId
        )}</div>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:18px;">
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:13px;width:160px;">Payment Method</td>
            <td style="padding:8px 0;font-size:14px;font-weight:600;color:#111827;">${escapeHtml(
              order.paymentMethod
            )}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:13px;">Received At</td>
            <td style="padding:8px 0;font-size:14px;color:#111827;">${submittedAt}</td>
          </tr>
          ${
            order.customerEmail
              ? `<tr>
              <td style="padding:8px 0;color:#6b7280;font-size:13px;">Customer Email</td>
              <td style="padding:8px 0;font-size:14px;color:#111827;">${escapeHtml(
                order.customerEmail
              )}</td>
            </tr>`
              : ""
          }
        </table>

        ${
          addressHtml
            ? `<div style="font-size:13px;color:#6b7280;margin-bottom:6px;">Shipping Address</div>
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;font-size:14px;line-height:1.6;color:#111827;margin-bottom:18px;">
                ${addressHtml}
              </div>`
            : ""
        }

        <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">Items</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;overflow:hidden;">
          <tr style="background:#f3f4f6;">
            <th align="left" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Item</th>
            <th align="center" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Qty</th>
            <th align="right" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Price</th>
            <th align="right" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Total</th>
          </tr>
          ${itemsHtml}
        </table>

        <div style="margin-top:18px;padding:14px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:14px;font-weight:600;color:#166534;">Total Amount</span>
          <span style="font-size:18px;font-weight:700;color:#166534;">${inr(
            order.totalAmount
          )}</span>
        </div>

        <div style="margin-top:22px;text-align:center;">
          <a href="https://www.piefoods.com/admin/orders" style="display:inline-block;background:#2f3b2d;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:14px;">Open Admin Panel</a>
        </div>

        <p style="margin:20px 0 0;font-size:12px;color:#6b7280;text-align:center;">
          Login at piefoods.com/admin/login to ship this order via Delhivery.
        </p>
      </td>
    </tr>
  </table>
</div>
  `.trim();

  const text = `
New Order Received

Order Number: ${displayId}
Payment: ${order.paymentMethod}
Received At: ${submittedAt}
Total: ${inr(order.totalAmount)}

Items:
${order.items
  .map((i) => `- ${i.name} x${i.quantity} = ${inr(i.lineTotal)}`)
  .join("\n")}

${
  order.address
    ? `Shipping Address:
${[
  order.address.name,
  order.address.address,
  `${order.address.city || ""}, ${order.address.state || ""} ${order.address.postal_code || ""}`.trim(),
  order.address.phone ? `Phone: ${order.address.phone}` : "",
]
  .filter(Boolean)
  .join("\n")}`
    : ""
}

Login to admin panel: https://www.piefoods.com/admin/login
  `.trim();

  return sendEmail({ to: adminEmail, subject, html, text });
}

interface ShippedEmailData {
  orderId: string;
  /** Friendly order number shown to the customer (e.g. PF2606120001). */
  displayOrderId?: string;
  customerEmail: string;
  customerName?: string;
  waybill: string;
  trackingUrl?: string;
  items: OrderEmailItem[];
  totalAmount: number;
}

/**
 * Send a "Your Order Has Been Shipped" email to the customer.
 * Triggered when an admin marks an order as shipped via Delhivery.
 */
export async function sendOrderShippedEmailToCustomer(
  data: ShippedEmailData
): Promise<boolean> {
  if (!data.customerEmail) return false;

  const displayId = (data.displayOrderId || "").trim() || data.orderId.slice(0, 12);
  const subject = `Your PIE Foods order has been shipped — ${displayId}`;

  const itemsHtml = buildItemsTable(data.items);
  const trackingUrl =
    data.trackingUrl ||
    `https://www.delhivery.com/track/package/${encodeURIComponent(
      data.waybill
    )}`;

  const html = `
<div style="margin:0;padding:24px;background:#f3f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr>
      <td style="background:#2f3b2d;padding:20px 24px;color:#fff;">
        <div style="font-size:22px;font-weight:700;">PIE Foods</div>
        <div style="font-size:13px;opacity:0.95;margin-top:6px;">Your order is on the way!</div>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 24px;">
        <p style="font-size:15px;color:#111827;margin:0 0 14px;">
          Hi${data.customerName ? " " + escapeHtml(data.customerName) : ""},
        </p>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 18px;">
          Great news — your PIE Foods order has been picked up by our courier partner
          <strong>Delhivery</strong> and is on its way to you.
        </p>

        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin-bottom:18px;">
          <div style="font-size:13px;color:#15803d;margin-bottom:6px;">Tracking Number (AWB)</div>
          <div style="font-size:18px;font-weight:700;color:#14532d;letter-spacing:0.04em;">${escapeHtml(
            data.waybill
          )}</div>
        </div>

        <div style="text-align:center;margin-bottom:22px;">
          <a href="${trackingUrl}" style="display:inline-block;background:#2f3b2d;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;font-size:14px;">Track Your Order</a>
        </div>

        <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">Order Summary</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;overflow:hidden;">
          <tr style="background:#f3f4f6;">
            <th align="left" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Item</th>
            <th align="center" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Qty</th>
            <th align="right" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Price</th>
            <th align="right" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Total</th>
          </tr>
          ${itemsHtml}
        </table>

        <div style="margin-top:18px;padding:14px 16px;background:#fafafa;border:1px solid #e5e7eb;border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:14px;font-weight:600;color:#374151;">Total Paid</span>
          <span style="font-size:18px;font-weight:700;color:#111827;">${inr(
            data.totalAmount
          )}</span>
        </div>

        <p style="margin:22px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
          You'll receive another update when your order is out for delivery.
          Need help? Reply to this email or write to us at piefoodsonline&#64;gmail.com.
        </p>
        <p style="margin:18px 0 0;font-size:13px;color:#111827;font-weight:600;">— Team PIE Foods</p>
      </td>
    </tr>
  </table>
</div>
  `.trim();

  const text = `
Hi${data.customerName ? " " + data.customerName : ""},

Great news — your PIE Foods order has been shipped via Delhivery!

Order Number: ${displayId}
Tracking Number (AWB): ${data.waybill}

Track your order: ${trackingUrl}

Items:
${data.items
  .map((i) => `- ${i.name} x${i.quantity} = ${inr(i.lineTotal)}`)
  .join("\n")}

Total: ${inr(data.totalAmount)}

— Team PIE Foods
  `.trim();

  return sendEmail({
    to: data.customerEmail,
    toName: data.customerName,
    subject,
    html,
    text,
  });
}

/* ===================================================================
   Status-change emails (out-for-delivery + delivered)
   =================================================================== */

interface StatusChangeEmailData {
  orderId: string;
  displayOrderId?: string;
  customerEmail: string;
  customerName?: string;
  waybill?: string;
  trackingUrl?: string;
}

/**
 * "Your order is out for delivery!" — fired the first time tracking flips
 * to OUT_FOR_DELIVERY. Customer typically receives this in the morning.
 */
export async function sendOrderOutForDeliveryEmail(
  data: StatusChangeEmailData
): Promise<boolean> {
  if (!data.customerEmail) return false;
  const displayId = (data.displayOrderId || "").trim() || data.orderId.slice(0, 12);
  const subject = `Out for delivery — your PIE Foods order ${displayId}`;
  const trackingUrl =
    data.trackingUrl ||
    (data.waybill
      ? `https://www.delhivery.com/track/package/${encodeURIComponent(data.waybill)}`
      : "");

  const html = `
<div style="margin:0;padding:24px;background:#f3f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr>
      <td style="background:#2f3b2d;padding:20px 24px;color:#fff;">
        <div style="font-size:22px;font-weight:700;">PIE Foods</div>
        <div style="font-size:13px;opacity:0.95;margin-top:6px;">Out for delivery today!</div>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 24px;">
        <p style="font-size:15px;color:#111827;margin:0 0 14px;">
          Hi${data.customerName ? " " + escapeHtml(data.customerName) : ""},
        </p>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 18px;">
          Great news — your PIE Foods order <strong>${escapeHtml(displayId)}</strong>
          is <strong>out for delivery</strong> and should reach you today.
          Please keep your phone handy so our courier partner can reach you.
        </p>
        ${
          data.waybill
            ? `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;margin-bottom:18px;">
                <div style="font-size:13px;color:#92400e;margin-bottom:6px;">Tracking Number (AWB)</div>
                <div style="font-size:18px;font-weight:700;color:#78350f;letter-spacing:0.04em;">${escapeHtml(
                  data.waybill
                )}</div>
              </div>`
            : ""
        }
        ${
          trackingUrl
            ? `<div style="text-align:center;margin-bottom:22px;">
                <a href="${trackingUrl}" style="display:inline-block;background:#2f3b2d;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;font-size:14px;">Track your delivery</a>
              </div>`
            : ""
        }
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
          Need to reschedule or have a question? Reply to this email or write to us at info&#64;piefoods.com.
        </p>
        <p style="margin:18px 0 0;font-size:13px;color:#111827;font-weight:600;">— Team PIE Foods</p>
      </td>
    </tr>
  </table>
</div>
  `.trim();

  const text = `
Hi${data.customerName ? " " + data.customerName : ""},

Your PIE Foods order ${displayId} is OUT FOR DELIVERY today.
${data.waybill ? `Tracking (AWB): ${data.waybill}` : ""}
${trackingUrl ? `Track: ${trackingUrl}` : ""}

Please keep your phone handy.

— Team PIE Foods
  `.trim();

  return sendEmail({
    to: data.customerEmail,
    toName: data.customerName,
    subject,
    html,
    text,
  });
}

/**
 * "Your order has been delivered!" — fired the first time tracking flips
 * to DELIVERED. Customer gets a friendly thank-you + soft ask for review.
 */
export async function sendOrderDeliveredEmail(
  data: StatusChangeEmailData
): Promise<boolean> {
  if (!data.customerEmail) return false;
  const displayId = (data.displayOrderId || "").trim() || data.orderId.slice(0, 12);
  const subject = `Delivered! Enjoy your PIE Foods order ${displayId}`;

  const html = `
<div style="margin:0;padding:24px;background:#f3f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr>
      <td style="background:#2f3b2d;padding:20px 24px;color:#fff;">
        <div style="font-size:22px;font-weight:700;">PIE Foods</div>
        <div style="font-size:13px;opacity:0.95;margin-top:6px;">Delivered — thank you!</div>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 24px;">
        <p style="font-size:15px;color:#111827;margin:0 0 14px;">
          Hi${data.customerName ? " " + escapeHtml(data.customerName) : ""},
        </p>
        <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 18px;">
          Your PIE Foods order <strong>${escapeHtml(displayId)}</strong> has been
          <strong>delivered</strong>. We hope you love what's inside.
        </p>

        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 18px;margin-bottom:18px;text-align:center;">
          <div style="font-size:14px;color:#166534;line-height:1.5;">
            Loved your goodies? It would mean the world if you left a quick review on the product page.
          </div>
        </div>

        <div style="text-align:center;margin-bottom:22px;">
          <a href="https://www.piefoods.com/products" style="display:inline-block;background:#2f3b2d;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;font-size:14px;">Shop again</a>
        </div>

        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
          Issue with the order? Reply within 7 days and we'll make it right. Reach us at info&#64;piefoods.com.
        </p>
        <p style="margin:18px 0 0;font-size:13px;color:#111827;font-weight:600;">— Team PIE Foods</p>
      </td>
    </tr>
  </table>
</div>
  `.trim();

  const text = `
Hi${data.customerName ? " " + data.customerName : ""},

Your PIE Foods order ${displayId} has been DELIVERED.

We hope you love what's inside! If you have a moment, please leave a quick review.

Shop again: https://www.piefoods.com/products

Issue with the order? Reply within 7 days and we'll make it right.

— Team PIE Foods
  `.trim();

  return sendEmail({
    to: data.customerEmail,
    toName: data.customerName,
    subject,
    html,
    text,
  });
}

/* ===================================================================
   New-customer welcome email
   =================================================================== */

interface WelcomeEmailData {
  customerEmail: string;
  customerName?: string;
}

/**
 * Fired the first time a user account is created (password register or
 * first-time OTP sign-in). Quick warm hello + brand intro + link to shop.
 * Best-effort: never throws.
 */
export async function sendWelcomeEmail(
  data: WelcomeEmailData
): Promise<boolean> {
  if (!data.customerEmail) return false;
  const subject = "Welcome to PIE Foods — clean food, no compromise";
  const firstName = (data.customerName || "").split(" ")[0].trim();
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";

  const html = `
<div style="margin:0;padding:24px;background:#f3f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr>
      <td style="background:#2f3b2d;padding:22px 24px;color:#fff;">
        <div style="font-size:24px;font-weight:700;">PIE Foods</div>
        <div style="font-size:13px;opacity:0.92;margin-top:4px;">Welcome to the family.</div>
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        <p style="font-size:15px;color:#111827;margin:0 0 14px;">${greeting}</p>
        <p style="font-size:14px;color:#374151;line-height:1.65;margin:0 0 18px;">
          Glad to have you on board. PIE Foods makes India's first monk fruit
          sweetener and clean freeze-dried fruit snacks — zero sugar, zero
          calories, FSSAI-certified, made for real Indian kitchens.
        </p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 18px;margin-bottom:18px;">
          <div style="font-size:13px;color:#166534;font-weight:700;margin-bottom:6px;">What's next</div>
          <ul style="margin:0;padding-left:18px;color:#15803d;font-size:13px;line-height:1.7;">
            <li>Browse the shop and pick what fits your kitchen</li>
            <li>Free delivery on every order above &#8377;599</li>
            <li>5% GST already included in every price you see</li>
          </ul>
        </div>
        <div style="text-align:center;margin-bottom:22px;">
          <a href="https://www.piefoods.com/products" style="display:inline-block;background:#2f3b2d;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;font-size:14px;">Start Shopping</a>
        </div>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
          Questions? Reply to this email or write to us at info&#64;piefoods.com.
        </p>
        <p style="margin:18px 0 0;font-size:13px;color:#111827;font-weight:600;">&mdash; Team PIE Foods</p>
      </td>
    </tr>
  </table>
</div>
  `.trim();

  const text = `
${firstName ? "Hi " + firstName : "Hi there"},

Welcome to PIE Foods! We make India's first monk fruit sweetener and clean freeze-dried fruit snacks.

What's next:
  - Browse the shop: https://www.piefoods.com/products
  - Free delivery above Rs.599
  - 5% GST already included in every price you see

Questions? Just reply to this email.

- Team PIE Foods
  `.trim();

  return sendEmail({
    to: data.customerEmail,
    toName: data.customerName,
    subject,
    html,
    text,
  });
}

/* ===================================================================
   Order Confirmed email (customer-facing) - with PDF invoice attached
   =================================================================== */

interface OrderConfirmedEmailData {
  orderId: string;
  displayOrderId?: string;
  customerEmail: string;
  customerName?: string;
  totalAmount: number;
  paymentMethod: string;
  items: OrderEmailItem[];
  /** Optional PDF invoice buffer; attached as Invoice-<orderId>.pdf when present. */
  invoicePdf?: Buffer;
}

/**
 * Fired the moment a customer's payment is verified. Confirms the order,
 * promises delivery + next-steps, attaches a PDF invoice. Best-effort.
 */
export async function sendOrderConfirmedEmailToCustomer(
  data: OrderConfirmedEmailData
): Promise<boolean> {
  if (!data.customerEmail) return false;
  const displayId =
    (data.displayOrderId || "").trim() || data.orderId.slice(0, 12);
  const subject = `Order confirmed - PIE Foods #${displayId}`;
  const itemsHtml = buildItemsTable(data.items);

  const html = `
<div style="margin:0;padding:24px;background:#f3f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr>
      <td style="background:#2f3b2d;padding:22px 24px;color:#fff;">
        <div style="font-size:22px;font-weight:700;">PIE Foods</div>
        <div style="font-size:13px;opacity:0.95;margin-top:6px;">Payment received - your order is confirmed</div>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 24px;">
        <p style="font-size:15px;color:#111827;margin:0 0 14px;">
          Hi${data.customerName ? " " + escapeHtml(data.customerName) : ""},
        </p>
        <p style="font-size:14px;color:#374151;line-height:1.65;margin:0 0 18px;">
          Thanks for your order. We've received your payment and your goodies
          are being packed. We'll email you the tracking link the moment our
          courier picks up the parcel.
        </p>

        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin-bottom:18px;">
          <div style="font-size:13px;color:#166534;margin-bottom:4px;">Order Number</div>
          <div style="font-size:18px;font-weight:700;color:#14532d;letter-spacing:0.04em;">${escapeHtml(displayId)}</div>
          <div style="font-size:13px;color:#15803d;margin-top:8px;">Total paid: <strong>${inr(data.totalAmount)}</strong> via ${escapeHtml(data.paymentMethod)}</div>
        </div>

        <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">Items</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;overflow:hidden;margin-bottom:18px;">
          <tr style="background:#f3f4f6;">
            <th align="left" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Item</th>
            <th align="center" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Qty</th>
            <th align="right" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Price</th>
            <th align="right" style="padding:10px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;">Total</th>
          </tr>
          ${itemsHtml}
        </table>

        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">
          A printable invoice is attached to this email as a PDF.
        </p>
        <p style="margin:18px 0 0;font-size:13px;color:#111827;font-weight:600;">&mdash; Team PIE Foods</p>
      </td>
    </tr>
  </table>
</div>
  `.trim();

  const text = `
Hi${data.customerName ? " " + data.customerName : ""},

Thanks for your order. Your payment has been received and your order is confirmed.

Order Number: ${displayId}
Total paid: ${inr(data.totalAmount)} via ${data.paymentMethod}

Items:
${data.items
  .map((i) => `  - ${i.name} x${i.quantity} = ${inr(i.lineTotal)}`)
  .join("\n")}

A PDF invoice is attached. We'll email you the tracking link when the courier picks up your parcel.

- Team PIE Foods
  `.trim();

  return sendEmail({
    to: data.customerEmail,
    toName: data.customerName,
    subject,
    html,
    text,
    attachments: data.invoicePdf
      ? [
          {
            filename: `Invoice-${displayId}.pdf`,
            content: data.invoicePdf,
            contentType: "application/pdf",
          },
        ]
      : undefined,
  });
}
