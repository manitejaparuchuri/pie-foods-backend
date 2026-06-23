import PDFDocument from "pdfkit";

/* ===================================================================
   PDF Invoice Generator
   ===================================================================
   Generates a one-page PDF invoice for a paid order. Returns a Buffer
   so it can be attached directly to the customer confirmation email.

   pdfkit is pure-JS — no Chrome / Puppeteer dependency — so it runs
   inside Cloud Run's small container without extra memory.
   =================================================================== */

export interface InvoiceItem {
  name: string;
  quantity: number;
  price: number;
  lineTotal: number;
}

export interface InvoiceAddress {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface InvoiceData {
  orderId: string;
  displayOrderId: string;
  orderDate: Date;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress?: InvoiceAddress;
  items: InvoiceItem[];
  subtotalAmount: number;
  couponDiscountAmount: number;
  shippingAmount: number;
  codSurchargeAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalAmount: number;
  paymentMethod: string;
}

const COLORS = {
  brand: "#2f3b2d",
  brandLight: "#f0fdf4",
  border: "#e5e7eb",
  text: "#111827",
  muted: "#6b7280",
  accent: "#15803d",
};

// Use "Rs." in the PDF — pdfkit's built-in fonts don't include the rupee glyph,
// so writing ₹ would render as a blank box. Customers see "Rs. 389.00".
function rupees(amount: number): string {
  const value = Number(amount) || 0;
  return `Rs. ${value.toFixed(2)}`;
}

function formatDateIst(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const yy = ist.getUTCFullYear();
  return `${dd}-${mm}-${yy}`;
}

function formatAddress(addr?: InvoiceAddress): string[] {
  if (!addr) return ["Shipping address on file"];
  const lines = [
    addr.name || "",
    addr.address || "",
    [addr.city, addr.state, addr.postal_code].filter(Boolean).join(", "),
    addr.country || "India",
  ];
  if (addr.phone) lines.push(`Phone: ${addr.phone}`);
  return lines.filter((l) => String(l).trim().length > 0);
}

/**
 * Render the invoice. Returns a Promise<Buffer> with the full PDF bytes.
 * Caller can pass the buffer straight to the email service as an attachment.
 */
export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `PIE Foods Invoice ${data.displayOrderId}`,
          Author: "PIE Foods",
          Subject: `Invoice for order ${data.displayOrderId}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // --- Header ---
      doc
        .rect(0, 0, doc.page.width, 80)
        .fill(COLORS.brand);
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(22)
        .text("PIE Foods", 50, 26)
        .fontSize(11)
        .font("Helvetica")
        .text("Purity in Everything", 50, 54);

      doc
        .fillColor("#ffffff")
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("TAX INVOICE", 0, 26, { align: "right", width: doc.page.width - 50 })
        .font("Helvetica")
        .fontSize(9)
        .text(
          `Issued ${formatDateIst(data.orderDate)}`,
          0,
          48,
          { align: "right", width: doc.page.width - 50 }
        );

      // --- Order block (left) + Billed to (right) ---
      const top = 110;
      doc
        .fillColor(COLORS.muted)
        .font("Helvetica")
        .fontSize(9)
        .text("INVOICE NUMBER", 50, top);
      doc
        .fillColor(COLORS.text)
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(data.displayOrderId, 50, top + 14);

      doc
        .fillColor(COLORS.muted)
        .font("Helvetica")
        .fontSize(9)
        .text("PAYMENT METHOD", 50, top + 42)
        .fillColor(COLORS.text)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(String(data.paymentMethod || "PREPAID").toUpperCase(), 50, top + 56);

      const rightX = 320;
      doc
        .fillColor(COLORS.muted)
        .font("Helvetica")
        .fontSize(9)
        .text("BILLED TO", rightX, top);

      const addressLines = formatAddress(data.shippingAddress);
      doc
        .fillColor(COLORS.text)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(data.customerName || addressLines[0] || "Customer", rightX, top + 14, {
          width: doc.page.width - rightX - 50,
        });

      let addrY = top + 30;
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.text);
      addressLines.slice(1).forEach((line) => {
        doc.text(line, rightX, addrY, { width: doc.page.width - rightX - 50 });
        addrY += 13;
      });
      if (data.customerEmail) {
        doc
          .fillColor(COLORS.muted)
          .fontSize(9)
          .text(data.customerEmail, rightX, addrY + 4);
      }

      // --- Items table ---
      const tableTop = Math.max(top + 110, addrY + 30);
      doc
        .moveTo(50, tableTop - 6)
        .lineTo(doc.page.width - 50, tableTop - 6)
        .strokeColor(COLORS.border)
        .lineWidth(0.6)
        .stroke();

      const col = {
        item: 50,
        qty: 320,
        price: 380,
        total: 470,
      };

      doc
        .fillColor(COLORS.muted)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("ITEM", col.item, tableTop)
        .text("QTY", col.qty, tableTop, { width: 40, align: "center" })
        .text("PRICE", col.price, tableTop, { width: 70, align: "right" })
        .text("AMOUNT", col.total, tableTop, { width: 75, align: "right" });

      doc
        .moveTo(50, tableTop + 16)
        .lineTo(doc.page.width - 50, tableTop + 16)
        .strokeColor(COLORS.border)
        .stroke();

      let rowY = tableTop + 24;
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.text);
      for (const item of data.items) {
        const nameHeight = doc.heightOfString(item.name, {
          width: col.qty - col.item - 10,
        });
        doc.text(item.name, col.item, rowY, {
          width: col.qty - col.item - 10,
        });
        doc.text(String(item.quantity), col.qty, rowY, {
          width: 40,
          align: "center",
        });
        doc.text(rupees(item.price), col.price, rowY, {
          width: 70,
          align: "right",
        });
        doc
          .font("Helvetica-Bold")
          .text(rupees(item.lineTotal), col.total, rowY, {
            width: 75,
            align: "right",
          })
          .font("Helvetica");
        rowY += Math.max(nameHeight, 12) + 8;
      }

      // --- Totals box ---
      const totalsTop = rowY + 10;
      const totalsBoxX = 320;
      const totalsBoxWidth = doc.page.width - 50 - totalsBoxX;

      const rows: Array<[string, string, boolean?]> = [
        ["Subtotal (MRP)", rupees(data.subtotalAmount)],
        ...(data.couponDiscountAmount > 0
          ? ([
              [
                "Discount",
                "- " + rupees(data.couponDiscountAmount),
              ] as [string, string],
            ])
          : ([] as Array<[string, string]>)),
        ["CGST (2.5%, included)", rupees(data.cgstAmount)],
        ["SGST (2.5%, included)", rupees(data.sgstAmount)],
        [
          "Shipping",
          data.shippingAmount > 0 ? rupees(data.shippingAmount) : "Free",
        ],
        ...(data.codSurchargeAmount > 0
          ? ([
              [
                "COD surcharge",
                rupees(data.codSurchargeAmount),
              ] as [string, string],
            ])
          : ([] as Array<[string, string]>)),
      ];

      let tY = totalsTop;
      doc.font("Helvetica").fontSize(10);
      for (const [label, value] of rows) {
        doc.fillColor(COLORS.muted).text(label, totalsBoxX, tY, {
          width: totalsBoxWidth - 80,
        });
        doc.fillColor(COLORS.text).text(value, totalsBoxX + totalsBoxWidth - 80, tY, {
          width: 80,
          align: "right",
        });
        tY += 16;
      }

      doc
        .moveTo(totalsBoxX, tY + 4)
        .lineTo(doc.page.width - 50, tY + 4)
        .strokeColor(COLORS.brand)
        .lineWidth(1.2)
        .stroke();

      doc
        .fillColor(COLORS.text)
        .font("Helvetica-Bold")
        .fontSize(13)
        .text("Total Paid", totalsBoxX, tY + 12, { width: totalsBoxWidth - 80 })
        .text(rupees(data.totalAmount), totalsBoxX + totalsBoxWidth - 80, tY + 12, {
          width: 80,
          align: "right",
        });

      // --- Footer note ---
      const footerY = doc.page.height - 80;
      doc
        .fillColor(COLORS.muted)
        .font("Helvetica")
        .fontSize(8)
        .text(
          "All product prices listed are inclusive of 5% GST. Embedded GST shown above is split equally between CGST and SGST.",
          50,
          footerY,
          { width: doc.page.width - 100 }
        )
        .text(
          "PIE Foods - info@piefoods.com - www.piefoods.com",
          50,
          footerY + 24,
          { width: doc.page.width - 100 }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
