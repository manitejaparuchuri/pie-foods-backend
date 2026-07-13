/**
 * Fallback discount used ONLY when a product row is missing its own
 * discount_percent field. Kept at 0 so an unconfigured product sells at
 * MRP — the admin has to explicitly opt every product into a discount.
 *
 * (Historically this was 0.2, a legacy from when the store had a
 * site-wide 20% sale; that silently applied 20% off to products where
 * the admin hadn't set anything. Removed.)
 *
 * Still env-overridable for the rare case the business wants to
 * re-enable a store-wide default without touching the code.
 */
export const ORDER_DISCOUNT_RATE = Number(process.env.ORDER_DISCOUNT_RATE || 0);

/**
 * GST model used by PIE Foods: all listed product prices are INCLUSIVE of
 * 5% GST. We do NOT add tax on top of the discounted subtotal — the
 * customer pays exactly what the price tag says. For invoice/compliance
 * reporting we extract the embedded GST component (split 2.5% CGST / 2.5% SGST).
 *
 * Previously we used 9% CGST + 9% SGST = 18% added ON TOP. That was wrong:
 * customers were being over-charged 18% beyond the listed price.
 */
export const INCLUSIVE_GST_RATE = Number(process.env.INCLUSIVE_GST_RATE || 0.05);

/**
 * Shipping rules:
 *   • Cart total (subtotal − discount) >= ₹599 → free delivery
 *   • Below threshold → flat ₹49 shipping fee
 *   • COD orders → additional ₹39 cash-handling surcharge
 *
 * All three values are env-overridable so the business can tune without a
 * code change. They double as the DEFAULTS for the admin-editable shipping
 * config stored in Firestore (site_settings/shipping) — callers can pass a
 * live override into the calc functions below so admin edits actually move
 * the charged total.
 */
export const SHIPPING_FREE_THRESHOLD = Number(
  process.env.SHIPPING_FREE_THRESHOLD || 599
);
export const SHIPPING_FEE = Number(process.env.SHIPPING_FEE || 49);
export const COD_SURCHARGE = Number(process.env.COD_SURCHARGE || 39);

/** Admin-editable shipping knobs. Any omitted field falls back to the
 *  constant defaults above (49 / 599 / 39). */
export interface ShippingConfig {
  shippingFee: number;
  freeShippingThreshold: number;
  codSurcharge: number;
}

const toPaise = (rupees: number): number => Math.round((Number(rupees) || 0) * 100);
const fromPaise = (paise: number): number => Math.round((paise + Number.EPSILON)) / 100;

/** Use the candidate only when it's a finite, non-negative number; else fallback. */
const numberOr = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export type PaymentMethodForPricing = "RAZORPAY" | "COD";

export interface PricingInputItem {
  productId: number;
  quantity: number;
  mrpRupees: number;
  /** Per-product discount (0..100). Omit / pass null only when the product
   *  has no discount configured — the pricing engine will then charge MRP
   *  (unless the ORDER_DISCOUNT_RATE env override is explicitly non-zero). */
  discountPercent?: number | null;
}

export interface PricedItem {
  product_id: number;
  quantity: number;
  /** The product's "printed" price BEFORE any discount — shown as MRP on the invoice. */
  mrp: number;
  /** Sale price after the configured discount (this is what the customer pays per unit). */
  discountedPrice: number;
  lineTotal: number;
}

export interface PricingTotals {
  subtotalAmount: number;
  couponDiscountAmount: number;
  taxableSubtotalAmount: number;
  shippingAmount: number;
  codSurchargeAmount: number;
  /** CGST 2.5% embedded inside the goods total (display-only). */
  cgstAmount: number;
  /** SGST 2.5% embedded inside the goods total (display-only). */
  sgstAmount: number;
  totalAmount: number;
}

export interface OrderPricingResult extends PricingTotals {
  pricedItems: PricedItem[];
}

const clampPaise = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const buildPricedItemsAndSubtotal = (
  items: PricingInputItem[]
): { pricedItems: PricedItem[]; subtotalPaise: number } => {
  const pricedItems = items.map((item) => {
    const mrpRupees = Number(item.mrpRupees) || 0;
    const mrpPaise = toPaise(mrpRupees);
    const rate =
      item.discountPercent === undefined || item.discountPercent === null
        ? ORDER_DISCOUNT_RATE
        : Math.min(Math.max(Number(item.discountPercent) || 0, 0), 90) / 100;
    // Truncate to WHOLE rupees per unit — never store or charge paisa.
    // If the sticker says ₹129/unit, qty 5 must be exactly ₹645 (not ₹647
    // from a 0.35 carry). Drops everything after the decimal regardless
    // of whether it's below or above 0.5.
    const discountedPriceRupees = Math.floor(mrpRupees * (1 - rate));
    const discountedPricePaise = toPaise(discountedPriceRupees);
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const lineTotalPaise = discountedPricePaise * quantity;

    return {
      product_id: item.productId,
      quantity,
      mrpPaise,
      discountedPricePaise,
      lineTotalPaise,
    };
  });

  const subtotalPaise = pricedItems.reduce((sum, item) => sum + item.lineTotalPaise, 0);

  return {
    pricedItems: pricedItems.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      mrp: fromPaise(item.mrpPaise),
      discountedPrice: fromPaise(item.discountedPricePaise),
      lineTotal: fromPaise(item.lineTotalPaise),
    })),
    subtotalPaise,
  };
};

export const calculateTotalsFromSubtotal = (
  subtotalPaise: number,
  couponDiscountRupees = 0,
  paymentMethod: PaymentMethodForPricing = "RAZORPAY",
  shippingConfig?: Partial<ShippingConfig> | null
): PricingTotals => {
  const subtotal = Math.max(0, subtotalPaise);
  const couponDiscountPaise = clampPaise(toPaise(couponDiscountRupees), 0, subtotal);
  const taxableSubtotalPaise = subtotal - couponDiscountPaise;
  const taxableSubtotalRupees = fromPaise(taxableSubtotalPaise);

  // Live (admin-editable) shipping knobs, falling back to the constant
  // defaults whenever a field is absent/invalid so the charged total is
  // always well-defined.
  const freeThreshold = numberOr(shippingConfig?.freeShippingThreshold, SHIPPING_FREE_THRESHOLD);
  const shippingFee = numberOr(shippingConfig?.shippingFee, SHIPPING_FEE);
  const codSurcharge = numberOr(shippingConfig?.codSurcharge, COD_SURCHARGE);

  // Shipping rules: free at/above the threshold, flat fee below.
  const shippingFeePaise =
    taxableSubtotalRupees >= freeThreshold
      ? 0
      : toPaise(shippingFee);

  // COD surcharge layered on top of shipping.
  const codSurchargePaise =
    paymentMethod === "COD" ? toPaise(codSurcharge) : 0;

  // The customer pays exactly (goods inclusive-of-GST) + shipping + COD.
  // We round UP to whole rupees so Razorpay never shows decimals — anything
  // smaller-than-a-rupee that lingers from legacy data gets absorbed here.
  const grossPaise = taxableSubtotalPaise + shippingFeePaise + codSurchargePaise;
  const totalRupees = Math.round(fromPaise(grossPaise));
  const totalPaise = totalRupees * 100;

  // Extract the embedded GST from the goods portion only (shipping isn't taxed
  // here — the displayed shipping fee is already what the customer pays).
  // base × (1 + rate) = goods → base = goods / 1.05 → gst = goods − base
  const goodsRupees = taxableSubtotalRupees;
  const goodsBaseRupees = goodsRupees / (1 + INCLUSIVE_GST_RATE);
  const goodsGstRupees = goodsRupees - goodsBaseRupees;
  const totalGstPaise = toPaise(goodsGstRupees);
  const cgstPaise = Math.round(totalGstPaise / 2);
  const sgstPaise = totalGstPaise - cgstPaise; // exact split

  return {
    subtotalAmount: fromPaise(subtotal),
    couponDiscountAmount: fromPaise(couponDiscountPaise),
    taxableSubtotalAmount: taxableSubtotalRupees,
    shippingAmount: fromPaise(shippingFeePaise),
    codSurchargeAmount: fromPaise(codSurchargePaise),
    cgstAmount: fromPaise(cgstPaise),
    sgstAmount: fromPaise(sgstPaise),
    totalAmount: fromPaise(totalPaise),
  };
};

export const calculateOrderPricing = (
  items: PricingInputItem[],
  couponDiscountRupees = 0,
  paymentMethod: PaymentMethodForPricing = "RAZORPAY",
  shippingConfig?: Partial<ShippingConfig> | null
): OrderPricingResult => {
  const { pricedItems, subtotalPaise } = buildPricedItemsAndSubtotal(items);
  const totals = calculateTotalsFromSubtotal(
    subtotalPaise,
    couponDiscountRupees,
    paymentMethod,
    shippingConfig
  );

  return {
    pricedItems,
    ...totals,
  };
};

