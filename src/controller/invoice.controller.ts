import { Request, Response } from "express";
import { Timestamp } from "firebase-admin/firestore";

import { firestore } from "../config/firebase";
import { AuthRequest } from "../middlewares/auth";
import {
  generateInvoicePdf,
  InvoiceData,
  InvoiceItem,
} from "../services/invoice-pdf.service";
import { loadGuestOrderForAccess } from "../services/guest-order.service";

const ordersCollection = firestore.collection("orders");
const usersCollection = firestore.collection("users");

function buildInvoiceItems(raw: unknown): InvoiceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: Record<string, unknown>) => {
    const price = Number(item.price) || 0;
    const quantity = Number(item.quantity) || 0;
    const mrp = Number(item.mrp) > 0 ? Number(item.mrp) : price;
    const taxRaw = Number(item.tax_percent);
    const taxPercent =
      Number.isFinite(taxRaw) && taxRaw >= 0 && taxRaw <= 50 ? taxRaw : 5;
    return {
      name: String(item.name || "Product"),
      quantity,
      mrp,
      price,
      lineTotal: Number(item.line_total) || price * quantity,
      taxPercent,
    };
  });
}

async function resolveAddress(data: Record<string, any>) {
  const inline = data.shipping_address as Record<string, unknown> | undefined;
  if (inline) {
    return {
      name: String(inline.name || data.customer_name || ""),
      phone: String(inline.phone || data.customer_phone || ""),
      address: String(inline.address || ""),
      city: String(inline.city || ""),
      state: String(inline.state || ""),
      postal_code: String(inline.postal_code || ""),
      country: String(inline.country || "India"),
    };
  }

  const uid = data.user_id ? String(data.user_id) : "";
  const sid = data.shipping_id ? String(data.shipping_id) : "";
  if (uid && sid) {
    try {
      const snap = await usersCollection
        .doc(uid)
        .collection("addresses")
        .doc(sid)
        .get();
      if (snap.exists) {
        const a = snap.data() as Record<string, unknown>;
        return {
          name: String(a.name || ""),
          phone: String(a.phone || ""),
          address: String(a.address || ""),
          city: String(a.city || ""),
          state: String(a.state || ""),
          postal_code: String(a.postal_code || ""),
          country: String(a.country || "India"),
        };
      }
    } catch {
      /* best-effort — the invoice still renders without an address */
    }
  }
  return undefined;
}

async function buildInvoiceData(
  orderId: string,
  data: Record<string, any>
): Promise<InvoiceData> {
  const orderDateTs = data.order_date as Timestamp | undefined;
  return {
    orderId,
    displayOrderId: data.order_number
      ? String(data.order_number)
      : orderId.slice(0, 12),
    orderDate: orderDateTs ? orderDateTs.toDate() : new Date(),
    customerName: data.customer_name ? String(data.customer_name) : undefined,
    customerEmail: data.customer_email ? String(data.customer_email) : undefined,
    customerPhone: data.customer_phone ? String(data.customer_phone) : undefined,
    shippingAddress: await resolveAddress(data),
    items: buildInvoiceItems(data.items),
    subtotalAmount: Number(data.subtotal_amount) || 0,
    couponDiscountAmount: Number(data.coupon_discount_amount) || 0,
    shippingAmount: Number(data.shipping_amount) || 0,
    codSurchargeAmount: Number(data.cod_surcharge_amount) || 0,
    cgstAmount: Number(data.cgst_amount) || 0,
    sgstAmount: Number(data.sgst_amount) || 0,
    totalAmount: Number(data.total_amount) || 0,
    paymentMethod: String(data.payment_method || "RAZORPAY"),
  };
}

function sendPdf(res: Response, pdf: Buffer, displayOrderId: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="invoice-${displayOrderId}.pdf"`
  );
  res.setHeader("Content-Length", pdf.length);
  return res.send(pdf);
}

/** GET /api/orders/:id/invoice — owner (or admin) downloads the GST invoice. */
export const downloadInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    const role = req.user?.role;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const orderId = String(req.params.id || "").trim();
    if (!orderId) return res.status(400).json({ message: "Invalid order id" });

    const snap = await ordersCollection.doc(orderId).get();
    if (!snap.exists) return res.status(404).json({ message: "Order not found" });

    const data = snap.data() as Record<string, any>;
    if (String(data.user_id || "") !== uid && role !== "admin") {
      return res.status(404).json({ message: "Order not found" });
    }

    const invoiceData = await buildInvoiceData(orderId, data);
    const pdf = await generateInvoicePdf(invoiceData);
    return sendPdf(res, pdf, invoiceData.displayOrderId);
  } catch (error: any) {
    console.error("DOWNLOAD INVOICE ERROR:", error?.message || error);
    return res.status(500).json({ message: "Failed to generate invoice" });
  }
};

/** GET /api/orders/guest/:id/invoice?token= — guest downloads via access token. */
export const downloadGuestInvoice = async (req: Request, res: Response) => {
  try {
    const orderId = String(req.params.id || "").trim();
    const token = String(
      req.query.token || req.headers["x-guest-token"] || ""
    ).trim();

    const { data } = await loadGuestOrderForAccess(orderId, token);
    const invoiceData = await buildInvoiceData(orderId, data as Record<string, any>);
    const pdf = await generateInvoicePdf(invoiceData);
    return sendPdf(res, pdf, invoiceData.displayOrderId);
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (
      msg === "Order not found" ||
      msg === "Order id and access token are required"
    ) {
      return res.status(404).json({ message: "Order not found" });
    }
    console.error("DOWNLOAD GUEST INVOICE ERROR:", error);
    return res.status(500).json({ message: "Failed to generate invoice" });
  }
};
