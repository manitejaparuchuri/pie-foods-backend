/**
 * Manual test harness for welcome + order-confirmed emails (with PDF invoice).
 *
 * Hits the EXACT production code paths (notify functions / generateInvoicePdf /
 * sendOrderConfirmedEmailToCustomer) — no Razorpay round-trip needed.
 *
 * Usage (from pie-foods-backend/):
 *
 *   # 1. Just render the PDF locally (no email sent). Writes ./test-invoice.pdf
 *   npx ts-node src/scripts/test-notifications.ts pdf
 *
 *   # 2. Send welcome email to YOU
 *   npx ts-node src/scripts/test-notifications.ts welcome you@example.com "Your Name"
 *
 *   # 3. Send full order-confirmed email + PDF attachment to YOU
 *   #    (uses a synthetic order — no Firestore order needed)
 *   npx ts-node src/scripts/test-notifications.ts order you@example.com
 *
 *   # 4. Same but pulled from a REAL order doc (forces TO = your email,
 *   #    does NOT mark the order as notified so you can re-run)
 *   npx ts-node src/scripts/test-notifications.ts order you@example.com PF2606230001
 */

import "./_load-env-yaml";
import fs from "fs";
import path from "path";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import {
  generateInvoicePdf,
  InvoiceData,
  InvoiceItem,
} from "../services/invoice-pdf.service";
import {
  sendOrderConfirmedEmailToCustomer,
  sendWelcomeEmail,
} from "../services/email.service";

firestore.settings({ preferRest: true });

const ordersCollection = firestore.collection("orders");

function syntheticInvoice(toEmail: string, name = "Test Customer"): InvoiceData {
  // Three items — first shows a real MRP discount (5% GST), second is sold
  // at MRP with NO discount (5% GST), third uses an 18% GST rate to verify
  // the multi-rate tax breakdown renders correctly.
  const items: InvoiceItem[] = [
    {
      name: "Monk Fruit Sweetener 250g",
      quantity: 2,
      mrp: 399,
      price: 299,
      taxPercent: 5,
      lineTotal: 598,
    },
    {
      name: "Freeze-Dried Mango Chips 50g",
      quantity: 1,
      mrp: 149,
      price: 149,
      taxPercent: 5,
      lineTotal: 149,
    },
    {
      name: "Premium Combo Pack (18% GST sample)",
      quantity: 1,
      mrp: 599,
      price: 499,
      taxPercent: 18,
      lineTotal: 499,
    },
  ];
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const shipping = 0; // total > 599 → free
  const codSurcharge = 0;
  const totalAmount = subtotal + shipping + codSurcharge;
  // Display-only header amounts; the PDF re-computes per-item tax internally.
  let cgst = 0;
  let sgst = 0;
  items.forEach((i) => {
    const goodsBase = i.lineTotal / (1 + (i.taxPercent || 5) / 100);
    const lineTax = i.lineTotal - goodsBase;
    cgst += lineTax / 2;
    sgst += lineTax / 2;
  });
  cgst = Math.round(cgst * 100) / 100;
  sgst = Math.round(sgst * 100) / 100;

  return {
    orderId: "TEST_" + Date.now(),
    displayOrderId: "PF2606230099",
    orderDate: new Date(),
    customerName: name,
    customerEmail: toEmail,
    customerPhone: "+91 90000 00000",
    shippingAddress: {
      name,
      phone: "+91 90000 00000",
      address: "Plot 7, Banjara Hills, Road No. 12",
      city: "Hyderabad",
      state: "Telangana",
      postal_code: "500034",
      country: "India",
    },
    items,
    subtotalAmount: subtotal,
    couponDiscountAmount: 0,
    shippingAmount: shipping,
    codSurchargeAmount: codSurcharge,
    cgstAmount: cgst,
    sgstAmount: sgst,
    totalAmount,
    paymentMethod: "RAZORPAY",
  };
}

async function buildInvoiceFromRealOrder(
  orderId: string,
  forcedEmail: string
): Promise<InvoiceData> {
  const snap = await ordersCollection.doc(orderId).get();
  if (!snap.exists) {
    throw new Error(`Order not found: ${orderId}`);
  }
  const order = snap.data() as Record<string, unknown>;

  const items: InvoiceItem[] = Array.isArray(order.items)
    ? (order.items as Array<Record<string, unknown>>).map((it) => {
        const price = Number(it.price) || 0;
        const mrp = Number(it.mrp) > 0 ? Number(it.mrp) : price;
        const taxRaw = Number(it.tax_percent);
        const taxPercent = Number.isFinite(taxRaw) && taxRaw >= 0 ? taxRaw : 5;
        return {
          name: String(it.name || it.product_name || "Item"),
          quantity: Number(it.quantity) || 0,
          mrp,
          price,
          taxPercent,
          lineTotal:
            Number(it.line_total ?? price * (Number(it.quantity) || 0)) || 0,
        };
      })
    : [];

  const orderDateTs = order.order_date as Timestamp | undefined;
  const orderDate = orderDateTs?.toDate?.() || new Date();
  const addressRaw = (order.shipping_address as Record<string, unknown>) || null;

  return {
    orderId,
    displayOrderId: String(order.order_number || orderId.slice(0, 12)),
    orderDate,
    customerName: String(order.customer_name || ""),
    customerEmail: forcedEmail, // forced for testing
    customerPhone: String(order.customer_phone || ""),
    shippingAddress: addressRaw
      ? {
          name: String(addressRaw.name || ""),
          phone: String(addressRaw.phone || ""),
          address: String(addressRaw.address || ""),
          city: String(addressRaw.city || ""),
          state: String(addressRaw.state || ""),
          postal_code: String(addressRaw.postal_code || ""),
          country: String(addressRaw.country || "India"),
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
}

async function main(): Promise<void> {
  console.log("[debug] BREVO_API_KEY present?", Boolean(process.env.BREVO_API_KEY));
  console.log("[debug] BREVO_FROM_EMAIL =", process.env.BREVO_FROM_EMAIL || "(missing)");
  console.log("[debug] SMTP_HOST =", process.env.SMTP_HOST || "(missing)");

  const [, , mode, arg2, arg3] = process.argv;

  if (!mode) {
    console.error("Usage: ts-node test-notifications.ts <pdf|welcome|order> ...");
    process.exit(1);
  }

  if (mode === "pdf") {
    const data = syntheticInvoice("preview@example.com");
    const buf = await generateInvoicePdf(data);
    const outPath = path.resolve(process.cwd(), "test-invoice.pdf");
    fs.writeFileSync(outPath, buf);
    console.log(`\n[OK] PDF written: ${outPath}`);
    console.log(`     Open it to inspect the layout. No email was sent.\n`);
    return;
  }

  if (mode === "welcome") {
    const toEmail = arg2;
    const name = arg3 || "Saiteja (Test)";
    if (!toEmail) throw new Error("welcome mode requires: <email> [name]");
    await sendWelcomeEmail({ customerEmail: toEmail, customerName: name });
    console.log(`\n[OK] Welcome email sent to: ${toEmail}`);
    console.log(`     From: BREVO_FROM_NAME <BREVO_FROM_EMAIL> (per .env.yaml)\n`);
    return;
  }

  if (mode === "order") {
    const toEmail = arg2;
    const realOrderId = arg3;
    if (!toEmail) throw new Error("order mode requires: <email> [orderId]");

    const data = realOrderId
      ? await buildInvoiceFromRealOrder(realOrderId, toEmail)
      : syntheticInvoice(toEmail);

    console.log(`Building PDF invoice (${data.items.length} item(s), total Rs. ${data.totalAmount})...`);
    const invoicePdf = await generateInvoicePdf(data);
    console.log(`PDF built: ${invoicePdf.length} bytes`);

    await sendOrderConfirmedEmailToCustomer({
      orderId: data.orderId,
      displayOrderId: data.displayOrderId,
      customerEmail: toEmail,
      customerName: data.customerName,
      totalAmount: data.totalAmount,
      paymentMethod: data.paymentMethod,
      items: data.items,
      invoicePdf,
    });

    console.log(`\n[OK] Order-confirmed email + PDF sent to: ${toEmail}`);
    console.log(`     Display order id: ${data.displayOrderId}`);
    console.log(`     Source: ${realOrderId ? `real order ${realOrderId}` : "synthetic data"}\n`);
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[ERR]", err?.message || err);
    process.exit(1);
  });
