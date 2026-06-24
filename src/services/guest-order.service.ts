import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { generateOrderNumber } from "./order-number.service";
import {
  buildPricedItemsAndSubtotal,
  calculateTotalsFromSubtotal,
} from "./pricing.service";
import { fetchProductsByIds } from "./product-lookup.service";

/* ===================================================================
   Guest Order Service
   ===================================================================
   Mirrors OrderService.createOrder but without requiring a Firebase user.
   The order is created in PENDING_PAYMENT state with `is_guest: true`
   and a 32-char `guest_access_token` that the customer's browser keeps
   for subsequent calls (pay, view, track).

   Key differences from logged-in flow:
     • No cart lookup — items are submitted inline in the request body
     • No saved shipping address — full address is submitted inline
     • No saved coupon usage tracking (TODO: support guest coupons later)
     • `user_id` is null; `customer_email/name/phone` populated instead
   =================================================================== */

const ordersCollection = firestore.collection("orders");

export interface GuestCartItem {
  productId: number;
  quantity: number;
}

export interface GuestShippingAddress {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  country?: string;
}

export interface GuestOrderInput {
  email: string;
  name: string;
  phone: string;
  address: GuestShippingAddress;
  items: GuestCartItem[];
  paymentMethod?: "RAZORPAY" | "COD";
}

export interface GuestOrderResult {
  orderId: string;
  orderNumber: string;
  guestAccessToken: string;
  totalAmount: number;
  subtotalAmount: number;
  paymentMethod: "RAZORPAY" | "COD";
  status: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-\s]{7,15}$/;
const PINCODE_RE = /^[0-9]{4,10}$/;

function generateAccessToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function validateGuestOrderInput(
  input: Partial<GuestOrderInput>
): { ok: true } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Invalid request body" };
  }
  const email = String(input.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "A valid email is required" };
  }
  const name = String(input.name || "").trim();
  if (name.length < 2) {
    return { ok: false, error: "Customer name is required" };
  }
  const phone = String(input.phone || "").trim();
  if (!PHONE_RE.test(phone)) {
    return { ok: false, error: "A valid phone number is required" };
  }

  const addr = input.address;
  if (!addr || typeof addr !== "object") {
    return { ok: false, error: "Shipping address is required" };
  }
  if (!String(addr.address || "").trim()) {
    return { ok: false, error: "Address line is required" };
  }
  if (!String(addr.city || "").trim()) {
    return { ok: false, error: "City is required" };
  }
  if (!String(addr.state || "").trim()) {
    return { ok: false, error: "State is required" };
  }
  if (!PINCODE_RE.test(String(addr.postal_code || "").trim())) {
    return { ok: false, error: "A valid pincode is required" };
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, error: "Cart is empty" };
  }
  for (const item of input.items) {
    if (
      !Number.isFinite(item?.productId) ||
      Number(item.productId) <= 0 ||
      !Number.isFinite(item?.quantity) ||
      Number(item.quantity) <= 0 ||
      Number(item.quantity) > 100
    ) {
      return { ok: false, error: "Invalid cart item" };
    }
  }

  return { ok: true };
}

export async function createGuestOrder(
  input: GuestOrderInput
): Promise<GuestOrderResult> {
  const email = String(input.email).trim().toLowerCase();
  const name = String(input.name).trim();
  const phone = String(input.phone).trim();
  const paymentMethod: "RAZORPAY" | "COD" =
    input.paymentMethod === "COD" ? "COD" : "RAZORPAY";

  // Fetch products from server, never trust client prices
  const productIds = input.items.map((i) => Number(i.productId));
  const productMap = await fetchProductsByIds(productIds);

  // Convert request items into pricing inputs using server-side prices
  const pricingInputs = input.items
    .map((i) => {
      const product = productMap.get(Number(i.productId));
      if (!product) return null;
      return {
        productId: product.product_id,
        quantity: Number(i.quantity),
        mrpRupees: product.price,
        discountPercent: product.discount_percent,
        taxPercent: product.tax_percent,
        name: product.name,
        imageUrl: product.image_url,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (pricingInputs.length === 0) {
    throw new Error("None of the items in the cart are available");
  }

  const { pricedItems, subtotalPaise } = buildPricedItemsAndSubtotal(
    pricingInputs.map((p) => ({
      productId: p.productId,
      quantity: p.quantity,
      mrpRupees: p.mrpRupees,
      discountPercent: p.discountPercent ?? undefined,
    }))
  );

  const totals = calculateTotalsFromSubtotal(subtotalPaise, 0, paymentMethod);

  if (totals.totalAmount <= 0) {
    throw new Error("Order amount must be greater than zero");
  }

  const itemsForStorage = pricedItems.map((priced) => {
    const meta = pricingInputs.find((p) => p.productId === priced.product_id);
    return {
      product_id: priced.product_id,
      name: meta?.name || "Product",
      image_url: meta?.imageUrl || null,
      quantity: priced.quantity,
      mrp: priced.mrp,
      price: priced.discountedPrice,
      tax_percent: meta?.taxPercent ?? 5,
      line_total: priced.lineTotal,
    };
  });

  const guestAccessToken = generateAccessToken();
  const orderRef = ordersCollection.doc();
  const orderNumber = await generateOrderNumber();

  await orderRef.set({
    order_id: orderRef.id,
    order_number: orderNumber,
    user_id: null,
    is_guest: true,
    guest_access_token: guestAccessToken,
    customer_email: email,
    customer_name: name,
    customer_phone: phone,
    shipping_address: {
      name: String(input.address.name || name).trim(),
      phone: String(input.address.phone || phone).trim(),
      address: String(input.address.address).trim(),
      city: String(input.address.city).trim(),
      state: String(input.address.state).trim(),
      postal_code: String(input.address.postal_code).trim(),
      country: String(input.address.country || "India").trim(),
    },
    shipping_id: null,
    status: "PENDING_PAYMENT",
    payment_method: paymentMethod,
    provider_order_id: null,
    coupon_id: null,
    coupon_code: null,
    subtotal_amount: totals.subtotalAmount,
    coupon_discount_amount: 0,
    shipping_amount: totals.shippingAmount,
    cod_surcharge_amount: totals.codSurchargeAmount,
    cgst_amount: totals.cgstAmount,
    sgst_amount: totals.sgstAmount,
    final_amount: totals.totalAmount,
    total_amount: totals.totalAmount,
    items: itemsForStorage,
    order_date: Timestamp.now(),
    updated_at: Timestamp.now(),
  });

  return {
    orderId: orderRef.id,
    orderNumber,
    guestAccessToken,
    totalAmount: totals.totalAmount,
    subtotalAmount: totals.subtotalAmount,
    paymentMethod,
    status: "PENDING_PAYMENT",
  };
}

/**
 * Verify that a `guest_access_token` matches the order document. Used to
 * authenticate guest-side requests (pay, view, track) without a logged-in user.
 *
 * Uses constant-time comparison to avoid timing attacks on the token.
 */
export async function loadGuestOrderForAccess(
  orderId: string,
  providedToken: string
): Promise<{ orderRef: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData }> {
  const trimmedOrderId = String(orderId || "").trim();
  const trimmedToken = String(providedToken || "").trim();
  if (!trimmedOrderId || !trimmedToken) {
    throw new Error("Order id and access token are required");
  }

  const orderRef = ordersCollection.doc(trimmedOrderId);
  const snap = await orderRef.get();
  if (!snap.exists) {
    throw new Error("Order not found");
  }

  const data = snap.data() as FirebaseFirestore.DocumentData;
  const storedToken = String(data.guest_access_token || "");
  if (!storedToken) {
    throw new Error("Order not found");
  }

  const a = Buffer.from(storedToken);
  const b = Buffer.from(trimmedToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Order not found");
  }

  return { orderRef, data };
}
