import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

/* ===================================================================
   PDF Invoice Generator
   ===================================================================
   GST tax invoice for a paid order. Layout follows the client's
   accountant-style format minus the HSN column (turnover-based
   requirement we don't hit yet) and the HSN/SAC summary table.

   Per-product tax: each item carries its own taxPercent (5/12/18 ...).
   The tax rows below the items group by rate, so a mixed-rate order
   renders e.g. CGST @2.5% Rs X + CGST @9% Rs Y.

   pdfkit is pure-JS — no Chrome / Puppeteer dependency — so it runs
   inside Cloud Run's small container without extra memory.

   Currency note: pdfkit's built-in Helvetica has no rupee glyph, so
   we render "Rs." everywhere. Embedding a Unicode TTF (NotoSans) is
   a follow-up if the client wants ₹ specifically.
   =================================================================== */

/* ---------------- Business identity (env-overridable) ---------------- */

const env = (key: string, fallback: string): string =>
  String(process.env[key] || "").trim() || fallback;

const BUSINESS = {
  name: env("BUSINESS_NAME", "PIE FOODS"),
  addressLine1: env(
    "BUSINESS_ADDRESS_1",
    "76-15-6/T2, Caliber Utsav, VD Puram, Krishna,"
  ),
  addressLine2: env("BUSINESS_ADDRESS_2", "Andhra Pradesh, 520012"),
  gstin: env("BUSINESS_GSTIN", "37BKTPP4130N1ZG"),
  pan: env("BUSINESS_PAN", "BKTPP4130N"),
  mobile: env("BUSINESS_MOBILE", "8188843334"),
  email: env("BUSINESS_EMAIL", "piefoodsonline@gmail.com"),
  jurisdiction: env("BUSINESS_JURISDICTION_CITY", "Krishna"),
};

const COLORS = {
  brand: "#2f3b2d",
  headerBg: "#e8f5e9",
  border: "#a8a8a8",
  text: "#111827",
  muted: "#6b7280",
};

/* Logo + signature loaded once at module init. If either file is missing
   the invoice continues to render without it. */
const ASSETS_DIR = path.resolve(__dirname, "..", "assets");

function tryReadAsset(filename: string): Buffer | null {
  try {
    return fs.readFileSync(path.resolve(ASSETS_DIR, filename));
  } catch {
    return null;
  }
}

const LOGO_BUFFER = tryReadAsset("pie-logo.jpg");
const SIGNATURE_BUFFER =
  tryReadAsset("signature.png") || tryReadAsset("signature.jpg");

/* ---------------- Public interface ---------------- */

export interface InvoiceItem {
  name: string;
  quantity: number;
  /** Per-unit MRP (printed price before discount). Defaults to `price`. */
  mrp?: number;
  /** Per-unit selling price (after discount). Inclusive of taxPercent GST. */
  price: number;
  lineTotal: number;
  /** Per-product GST %, defaults to 5 when missing. */
  taxPercent?: number;
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

/* ---------------- Formatting helpers ---------------- */

function rupees(amount: number): string {
  return `Rs. ${(Number(amount) || 0).toFixed(2)}`;
}

function rupeesWhole(amount: number): string {
  return `Rs. ${Math.round(Number(amount) || 0)}`;
}

function formatDateIst(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const yy = ist.getUTCFullYear();
  const h24 = ist.getUTCHours();
  const mins = String(ist.getUTCMinutes()).padStart(2, "0");
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = String(h24 % 12 || 12).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${h12}:${mins} ${ampm}`;
}

/* Indian-style number-to-words. Handles up to 99 crore. */
const WORDS_UNDER_20 = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
  "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
  "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const WORDS_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitsToWords(n: number): string {
  if (n < 20) return WORDS_UNDER_20[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return WORDS_TENS[t] + (u ? " " + WORDS_UNDER_20[u] : "");
}

function threeDigitsToWords(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(WORDS_UNDER_20[h] + " Hundred");
  if (rest) parts.push(twoDigitsToWords(rest));
  return parts.join(" ");
}

function amountInWords(amount: number): string {
  const whole = Math.floor(Number(amount) || 0);
  if (whole === 0) return "Zero Rupees";
  const crore = Math.floor(whole / 10000000);
  const lakh = Math.floor((whole % 10000000) / 100000);
  const thousand = Math.floor((whole % 100000) / 1000);
  const hundreds = whole % 1000;
  const parts: string[] = [];
  if (crore) parts.push(twoDigitsToWords(crore) + " Crore");
  if (lakh) parts.push(twoDigitsToWords(lakh) + " Lakh");
  if (thousand) parts.push(twoDigitsToWords(thousand) + " Thousand");
  if (hundreds) parts.push(threeDigitsToWords(hundreds));
  return parts.join(" ") + " Rupees";
}

function formatAddressBlock(addr: InvoiceAddress | undefined): string[] {
  if (!addr) return [];
  const lines: string[] = [];
  if (addr.address) lines.push(addr.address);
  const cityLine = [addr.city, addr.state, addr.postal_code]
    .filter(Boolean)
    .join(", ");
  if (cityLine) lines.push(cityLine);
  if (addr.country) lines.push(addr.country);
  return lines;
}

/* ---------------- Renderer ---------------- */

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 30,
        info: { Title: `Invoice ${data.displayOrderId}` },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageLeft = doc.page.margins.left;
      const pageRight = doc.page.width - doc.page.margins.right;
      const pageWidth = pageRight - pageLeft;

      /* --------- 1. TOP BAR: "TAX INVOICE" + badge --------- */
      let y = doc.page.margins.top;
      const titleFont = "Helvetica-Bold";
      const titleSize = 11;
      doc.font(titleFont).fontSize(titleSize);
      const titleW = doc.widthOfString("TAX INVOICE");
      doc.fillColor(COLORS.text).text("TAX INVOICE", pageLeft, y + 2, {
        lineBreak: false,
      });

      // Badge: positioned right after the title with a real gap; measured in
      // its own font/size so the box hugs the text correctly.
      const badgeText = "ORIGINAL FOR RECIPIENT";
      const badgePadX = 8;
      const badgePadY = 3;
      doc.font("Helvetica").fontSize(8);
      const badgeTextW = doc.widthOfString(badgeText);
      const badgeTextH = doc.currentLineHeight();
      const badgeBoxH = badgeTextH + badgePadY * 2;
      const badgeBoxW = badgeTextW + badgePadX * 2;
      const badgeX = pageLeft + titleW + 14;
      const badgeY = y + 2 + (titleSize - badgeBoxH) / 2 - 1;
      doc
        .roundedRect(badgeX, badgeY, badgeBoxW, badgeBoxH, 2)
        .strokeColor(COLORS.muted)
        .lineWidth(0.6)
        .stroke();
      doc.fillColor(COLORS.muted).text(
        badgeText,
        badgeX + badgePadX,
        badgeY + badgePadY,
        { lineBreak: false }
      );
      y += titleSize + 12;

      /* --------- 2. BUSINESS BOX + INVOICE NO/DATE BOX --------- */
      const businessBoxX = pageLeft;
      const businessBoxW = pageWidth * 0.55;
      const invoiceBoxX = pageLeft + businessBoxW;
      const invoiceBoxW = pageWidth - businessBoxW;
      const headerBoxH = 112;

      doc
        .rect(businessBoxX, y, businessBoxW, headerBoxH)
        .strokeColor(COLORS.border)
        .lineWidth(0.5)
        .stroke();
      doc
        .rect(invoiceBoxX, y, invoiceBoxW, headerBoxH)
        .strokeColor(COLORS.border)
        .lineWidth(0.5)
        .stroke();

      const logoSize = 60;
      const logoPadding = 8;
      if (LOGO_BUFFER) {
        try {
          doc.image(LOGO_BUFFER, businessBoxX + logoPadding, y + logoPadding, {
            fit: [logoSize, logoSize],
          });
        } catch {
          /* skip if logo decode fails */
        }
      }

      const textX = businessBoxX + logoPadding + logoSize + 12;
      const textW = businessBoxW - (logoPadding + logoSize + 12) - 6;
      let textY = y + 8;

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor(COLORS.brand)
        .text(BUSINESS.name, textX, textY, { width: textW });
      textY += 16;
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(COLORS.text)
        .text(BUSINESS.addressLine1, textX, textY, { width: textW });
      textY += 10;
      doc.text(BUSINESS.addressLine2, textX, textY, { width: textW });
      textY += 12;

      const labelW = 64;
      const drawKV = (label: string, value: string) => {
        doc.font("Helvetica-Bold").text(label, textX, textY);
        doc.font("Helvetica").text(value, textX + labelW, textY);
        textY += 10;
      };
      drawKV("GSTIN:", BUSINESS.gstin);
      drawKV("Mobile:", BUSINESS.mobile);
      drawKV("PAN Number:", BUSINESS.pan);
      drawKV("Email:", BUSINESS.email);

      // Right box: Invoice No + Invoice Date
      const colW = invoiceBoxW / 2;
      const col1X = invoiceBoxX;
      const col2X = invoiceBoxX + colW;
      const rightInnerY = y + Math.round(headerBoxH / 2) - 18;
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(COLORS.text)
        .text("Invoice No.", col1X, rightInnerY, { width: colW, align: "center" });
      doc.text("Invoice Date", col2X, rightInnerY, {
        width: colW,
        align: "center",
      });
      doc
        .font("Helvetica")
        .fontSize(10)
        .text(data.displayOrderId, col1X, rightInnerY + 20, {
          width: colW,
          align: "center",
        });
      doc.text(formatDateIst(data.orderDate), col2X, rightInnerY + 20, {
        width: colW,
        align: "center",
      });

      y += headerBoxH;

      /* --------- 3. BILL TO / SHIP TO --------- */
      const partyBoxH = 70;
      const partyW = pageWidth / 2;
      doc.rect(pageLeft, y, partyW, partyBoxH).strokeColor(COLORS.border).stroke();
      doc.rect(pageLeft + partyW, y, partyW, partyBoxH).strokeColor(COLORS.border).stroke();

      const partyPad = 6;
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text("BILL TO", pageLeft + partyPad, y + partyPad);
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(
          (data.customerName || data.shippingAddress?.name || "").toUpperCase() ||
            "CUSTOMER",
          pageLeft + partyPad,
          y + partyPad + 12,
          { width: partyW - partyPad * 2 }
        );

      let billY = y + partyPad + 26;
      doc.font("Helvetica").fontSize(8).fillColor(COLORS.text);
      if (data.shippingAddress?.state) {
        doc.text(
          `Place of Supply: ${data.shippingAddress.state}`,
          pageLeft + partyPad,
          billY,
          { width: partyW - partyPad * 2 }
        );
        billY += 10;
      }
      if (data.customerPhone || data.shippingAddress?.phone) {
        doc.text(
          `Mobile: ${data.shippingAddress?.phone || data.customerPhone}`,
          pageLeft + partyPad,
          billY,
          { width: partyW - partyPad * 2 }
        );
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text("SHIP TO", pageLeft + partyW + partyPad, y + partyPad);
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(
          (data.customerName || data.shippingAddress?.name || "").toUpperCase() ||
            "CUSTOMER",
          pageLeft + partyW + partyPad,
          y + partyPad + 12,
          { width: partyW - partyPad * 2 }
        );
      let shipY = y + partyPad + 26;
      doc.font("Helvetica").fontSize(8).fillColor(COLORS.text);
      formatAddressBlock(data.shippingAddress).forEach((line) => {
        doc.text(line, pageLeft + partyW + partyPad, shipY, {
          width: partyW - partyPad * 2,
        });
        shipY += 10;
      });

      y += partyBoxH;

      /* --------- 4. ITEMS TABLE — simple, matches the website order summary --------- */
      // Columns: S.NO | ITEMS | QTY | MRP | RATE | AMOUNT
      //
      // RATE is the per-unit price the admin set (inclusive of GST).
      // AMOUNT = RATE × QTY (the line total, also inclusive). No tax is ever
      // added on top — the reverse-calc breakdown sits in a separate block below
      // the items, exactly like the website's order summary.
      const colWidths = [
        pageWidth * 0.06, // S.NO
        pageWidth * 0.40, // ITEMS
        pageWidth * 0.08, // QTY
        pageWidth * 0.14, // MRP
        pageWidth * 0.14, // RATE
        pageWidth * 0.18, // AMOUNT
      ];
      const colXs: number[] = [];
      {
        let cx = pageLeft;
        for (const w of colWidths) {
          colXs.push(cx);
          cx += w;
        }
      }
      const colTitles = ["S.NO.", "ITEMS", "QTY.", "MRP", "RATE", "AMOUNT"];
      const colAligns: Array<"left" | "center" | "right"> = [
        "center",
        "left",
        "center",
        "right",
        "right",
        "right",
      ];

      const headerRowH = 22;
      doc.rect(pageLeft, y, pageWidth, headerRowH).fillColor(COLORS.headerBg).fill();
      doc.rect(pageLeft, y, pageWidth, headerRowH).strokeColor(COLORS.border).stroke();
      doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.text);
      colTitles.forEach((title, idx) => {
        doc.text(title, colXs[idx] + 3, y + 7, {
          width: colWidths[idx] - 6,
          align: idx === 1 ? "left" : "center",
        });
      });
      // Vertical separators between every column
      doc.strokeColor(COLORS.border).lineWidth(0.5);
      for (let i = 1; i < colXs.length; i += 1) {
        doc
          .moveTo(colXs[i], y)
          .lineTo(colXs[i], y + headerRowH)
          .stroke();
      }
      y += headerRowH;

      /* Item rows. Six columns, no per-line tax — tax breakdown sits in its
         own block below the table (same shape as the website summary). */
      const itemRowH = 26;
      const singleLineY = (rowY: number, lineHeight = 10) =>
        rowY + (itemRowH - lineHeight) / 2;

      // We still need running totals for the breakdown box (CGST/SGST below),
      // since each item can have its own tax %.
      let runningGoods = 0;
      let runningCgst = 0;
      let runningSgst = 0;
      // Track tax rates seen — used to label the CGST/SGST rows nicely when
      // every item shares the same rate.
      const taxRatesSeen = new Set<number>();

      doc.font("Helvetica").fontSize(8).fillColor(COLORS.text);
      data.items.forEach((item, idx) => {
        const rowY = y;
        doc.rect(pageLeft, rowY, pageWidth, itemRowH).strokeColor(COLORS.border).stroke();
        for (let i = 1; i < colXs.length; i += 1) {
          doc.moveTo(colXs[i], rowY).lineTo(colXs[i], rowY + itemRowH).stroke();
        }

        const mrp = Number(item.mrp ?? item.price) || 0;
        const price = Number(item.price) || 0;
        const discountPct =
          mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;

        const taxPercent =
          typeof item.taxPercent === "number" && item.taxPercent >= 0
            ? item.taxPercent
            : 5;
        taxRatesSeen.add(taxPercent);
        const lineTotal = Number(item.lineTotal) || 0;
        const goodsBase = lineTotal / (1 + taxPercent / 100);
        const lineTax = lineTotal - goodsBase;
        const lineGoods = Math.round(goodsBase * 100) / 100;
        const lineCgst = Math.round((lineTax / 2) * 100) / 100;
        const lineSgst = Math.round((lineTotal - lineGoods - lineCgst) * 100) / 100;
        runningGoods += lineGoods;
        runningCgst += lineCgst;
        runningSgst += lineSgst;

        const topLineTexts = [
          String(idx + 1),
          item.name,
          String(item.quantity),
          mrp.toFixed(2),
          price.toFixed(2),
          lineTotal.toFixed(2),
        ];
        const subLineTexts: Array<string | null> = [
          null,
          null,
          null,
          discountPct > 0 ? `(${discountPct}% OFF)` : null,
          null,
          null,
        ];

        topLineTexts.forEach((val, ci) => {
          const sub = subLineTexts[ci];
          if (sub) {
            doc.text(val, colXs[ci] + 3, rowY + 5, {
              width: colWidths[ci] - 6,
              align: colAligns[ci],
            });
            doc
              .fontSize(7)
              .fillColor(COLORS.muted)
              .text(sub, colXs[ci] + 3, rowY + 15, {
                width: colWidths[ci] - 6,
                align: colAligns[ci],
              })
              .fontSize(8)
              .fillColor(COLORS.text);
          } else {
            doc.text(val, colXs[ci] + 3, singleLineY(rowY), {
              width: colWidths[ci] - 6,
              align: colAligns[ci],
            });
          }
        });

        y += itemRowH;
      });

      /* --------- 5. Breakdown rows — mirrors the website order summary --------- */
      // Sub Total = sum of (rate × qty) = sum of AMOUNT column (inclusive of GST).
      // CGST / SGST are INFORMATIONAL — they're already inside Sub Total, never
      // added on top. TOTAL = Sub Total + Shipping + COD.
      const itemsSubtotal = data.items.reduce(
        (s, i) => s + (Number(i.lineTotal) || 0),
        0
      );

      // Label CGST/SGST rows with the single rate when every item shares one,
      // otherwise leave the rate off (mixed-rate orders).
      const singleRate =
        taxRatesSeen.size === 1 ? Array.from(taxRatesSeen)[0] : null;
      const halfRateLabel =
        singleRate === null
          ? ""
          : (() => {
              const h = singleRate / 2;
              return h === Math.floor(h)
                ? ` @${h}%`
                : ` @${h.toFixed(1)}%`;
            })();

      const summaryRowH = 18;
      const drawSummaryRow = (
        label: string,
        amount: number,
        opts?: { bold?: boolean; filled?: boolean; muted?: boolean }
      ) => {
        const h = summaryRowH;
        if (opts?.filled) {
          doc.rect(pageLeft, y, pageWidth, h).fillColor(COLORS.headerBg).fill();
        }
        doc.rect(pageLeft, y, pageWidth, h).strokeColor(COLORS.border).stroke();
        for (let i = 1; i < colXs.length; i += 1) {
          doc.moveTo(colXs[i], y).lineTo(colXs[i], y + h).stroke();
        }
        doc
          .font(opts?.bold ? "Helvetica-Bold" : "Helvetica-Oblique")
          .fontSize(opts?.bold ? 10 : 8)
          .fillColor(opts?.muted ? COLORS.muted : COLORS.text)
          .text(label, colXs[1] + 3, y + 5, {
            width:
              colWidths[1] +
              colWidths[2] +
              colWidths[3] +
              colWidths[4] -
              6,
            align: "right",
          });
        doc
          .font(opts?.bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(opts?.bold ? 10 : 8)
          .fillColor(opts?.muted ? COLORS.muted : COLORS.text)
          .text(
            opts?.bold ? rupeesWhole(amount) : rupees(amount),
            colXs[5] + 3,
            y + 5,
            {
              width: colWidths[5] - 6,
              align: "right",
            }
          );
        y += h;
      };

      drawSummaryRow("Sub Total", itemsSubtotal);
      drawSummaryRow(`Taxable Value`, runningGoods, { muted: true });
      drawSummaryRow(`CGST${halfRateLabel} (incl.)`, runningCgst, { muted: true });
      drawSummaryRow(`SGST${halfRateLabel} (incl.)`, runningSgst, { muted: true });
      if (data.shippingAmount > 0) drawSummaryRow("Shipping", data.shippingAmount);
      if (data.codSurchargeAmount > 0)
        drawSummaryRow("COD Surcharge", data.codSurchargeAmount);

      // Grand TOTAL — what the customer paid. Equals Sub Total + Shipping + COD.
      drawSummaryRow("TOTAL", data.totalAmount, { bold: true, filled: true });
      y += 12;

      /* --------- 6. TOTAL AMOUNT IN WORDS --------- */
      const wordsBoxH = 32;
      doc.rect(pageLeft, y, pageWidth, wordsBoxH).strokeColor(COLORS.border).stroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text("Total Amount (in words)", pageLeft + 6, y + 5);
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(amountInWords(data.totalAmount), pageLeft + 6, y + 17, {
          width: pageWidth - 12,
        });
      y += wordsBoxH + 12;

      /* --------- 7. TERMS + SIGNATORY --------- */
      const termsH = 80;
      const halfW = pageWidth / 2;
      doc.rect(pageLeft, y, halfW, termsH).strokeColor(COLORS.border).stroke();
      doc.rect(pageLeft + halfW, y, halfW, termsH).strokeColor(COLORS.border).stroke();

      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(COLORS.text)
        .text("Terms and Conditions", pageLeft + 6, y + 6);
      doc
        .font("Helvetica")
        .fontSize(8)
        .text(
          "1. Goods once sold will not be taken back or exchanged",
          pageLeft + 6,
          y + 20,
          { width: halfW - 12 }
        );
      doc.text(
        `2. All disputes are subject to ${BUSINESS.jurisdiction} jurisdiction only`,
        pageLeft + 6,
        y + 34,
        { width: halfW - 12 }
      );

      // Signature image (if available) + signatory text
      const sigCellX = pageLeft + halfW;
      if (SIGNATURE_BUFFER) {
        const sigW = 90;
        const sigH = 32;
        const sigX = sigCellX + (halfW - sigW) / 2;
        const sigY = y + 8;
        try {
          doc.image(SIGNATURE_BUFFER, sigX, sigY, { fit: [sigW, sigH] });
        } catch {
          /* skip on decode failure */
        }
      }
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(COLORS.text)
        .text("Authorised Signatory For", sigCellX, y + termsH - 26, {
          width: halfW,
          align: "center",
        });
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(BUSINESS.name, sigCellX, y + termsH - 14, {
          width: halfW,
          align: "center",
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
