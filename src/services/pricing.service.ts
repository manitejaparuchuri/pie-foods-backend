const ORDER_DISCOUNT_RATE = Number(process.env.ORDER_DISCOUNT_RATE || 0.2);
const CGST_RATE = Number(process.env.CGST_RATE || 0.09);
const SGST_RATE = Number(process.env.SGST_RATE || 0.09);

const toPaise = (rupees: number): number => Math.round((Number(rupees) || 0) * 100);
const fromPaise = (paise: number): number => Math.round((paise + Number.EPSILON)) / 100;

export interface PricingInputItem {
  productId: number;
  quantity: number;
  mrpRupees: number;
}

export interface PricedItem {
  product_id: number;
  quantity: number;
  discountedPrice: number;
  lineTotal: number;
}

export interface PricingTotals {
  subtotalAmount: number;
  couponDiscountAmount: number;
  taxableSubtotalAmount: number;
  cgstAmount: number;
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
    const mrpPaise = toPaise(item.mrpRupees);
    const discountedPricePaise = Math.round(mrpPaise * (1 - ORDER_DISCOUNT_RATE));
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const lineTotalPaise = discountedPricePaise * quantity;

    return {
      product_id: item.productId,
      quantity,
      discountedPricePaise,
      lineTotalPaise,
    };
  });

  const subtotalPaise = pricedItems.reduce((sum, item) => sum + item.lineTotalPaise, 0);

  return {
    pricedItems: pricedItems.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      discountedPrice: fromPaise(item.discountedPricePaise),
      lineTotal: fromPaise(item.lineTotalPaise),
    })),
    subtotalPaise,
  };
};

export const calculateTotalsFromSubtotal = (
  subtotalPaise: number,
  couponDiscountRupees = 0
): PricingTotals => {
  const subtotal = Math.max(0, subtotalPaise);
  const couponDiscountPaise = clampPaise(toPaise(couponDiscountRupees), 0, subtotal);
  const taxableSubtotalPaise = subtotal - couponDiscountPaise;
  const cgstPaise = Math.round(taxableSubtotalPaise * CGST_RATE);
  const sgstPaise = Math.round(taxableSubtotalPaise * SGST_RATE);
  const totalPaise = taxableSubtotalPaise + cgstPaise + sgstPaise;

  return {
    subtotalAmount: fromPaise(subtotal),
    couponDiscountAmount: fromPaise(couponDiscountPaise),
    taxableSubtotalAmount: fromPaise(taxableSubtotalPaise),
    cgstAmount: fromPaise(cgstPaise),
    sgstAmount: fromPaise(sgstPaise),
    totalAmount: fromPaise(totalPaise),
  };
};

export const calculateOrderPricing = (
  items: PricingInputItem[],
  couponDiscountRupees = 0
): OrderPricingResult => {
  const { pricedItems, subtotalPaise } = buildPricedItemsAndSubtotal(items);
  const totals = calculateTotalsFromSubtotal(subtotalPaise, couponDiscountRupees);

  return {
    pricedItems,
    ...totals,
  };
};

