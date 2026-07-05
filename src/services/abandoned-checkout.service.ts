import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";

/**
 * Abandoned-checkout / lead capture.
 *
 * As a shopper fills the checkout form (before they ever reach payment) the
 * storefront upserts a "lead" here, keyed by a browser-generated lead id. If
 * they complete an order the lead is marked CONVERTED; otherwise it stays
 * ABANDONED so the business can review + follow up (call / email / WhatsApp).
 *
 * This captures the customers the client asked about: the ones who reached the
 * cart/checkout and entered their details but never clicked / completed payment.
 */

const collection = firestore.collection("abandoned_checkouts");

/** Trim + hard-cap length so an abusive client can't inflate a lead doc toward
 *  Firestore's 1 MiB ceiling. 300 chars is plenty for any real address line. */
const clean = (v: unknown, max = 300): string => String(v ?? "").trim().slice(0, max);

export interface LeadItemInput {
  product_id?: number | string;
  name?: string;
  quantity?: number | string;
  price?: number | string;
}

export interface LeadInput {
  leadId?: string;
  name?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  userId?: string | null;
  items?: LeadItemInput[];
  cartTotal?: number | string;
}

/**
 * Create or update a checkout lead. No-ops (returns silently) unless the lead
 * has at least one piece of contact info, so we never store un-actionable rows.
 * Never resurrects a CONVERTED lead back to ABANDONED.
 */
export async function upsertCheckoutLead(input: LeadInput): Promise<void> {
  const leadId = clean(input.leadId);
  if (!leadId) throw new Error("leadId is required");

  const name = clean(input.name);
  const phone = clean(input.phone);
  const email = clean(input.email).toLowerCase();
  if (!name && !phone && !email) {
    // Nothing to contact them by yet — don't create an empty lead.
    return;
  }

  const ref = collection.doc(leadId);
  const snap = await ref.get();
  if (snap.exists && String(snap.data()?.status || "") === "CONVERTED") {
    return; // already ordered — leave it converted
  }

  const items = Array.isArray(input.items)
    ? input.items.slice(0, 50).map((i) => ({
        product_id: Number(i.product_id) || 0,
        name: clean(i.name, 150) || "Product",
        quantity: Number(i.quantity) || 0,
        price: Number(i.price) || 0,
      }))
    : [];

  const now = Timestamp.now();
  const payload: Record<string, unknown> = {
    lead_id: leadId,
    name: clean(name, 120),
    phone: clean(phone, 30),
    email: clean(email, 160),
    address_line1: clean(input.addressLine1),
    address_line2: clean(input.addressLine2),
    landmark: clean(input.landmark),
    city: clean(input.city, 120),
    state: clean(input.state, 120),
    pincode: clean(input.pincode, 20),
    country: clean(input.country, 80) || "India",
    user_id: input.userId ? clean(input.userId, 128) : null,
    items,
    cart_total: Number(input.cartTotal) || 0,
    updated_at: now,
  };
  if (!snap.exists) {
    // Only stamp status on CREATE. An update must never rewrite it, so a
    // trailing debounced save can't downgrade a just-CONVERTED lead back to
    // ABANDONED (the convert-vs-save race).
    payload.status = "ABANDONED";
    payload.created_at = now;
  }

  await ref.set(payload, { merge: true });
}

/** Mark a lead CONVERTED once the customer successfully places an order. */
export async function markCheckoutLeadConverted(
  leadId: string,
  orderId?: string
): Promise<void> {
  const id = clean(leadId);
  if (!id) return;
  const ref = collection.doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.set(
    {
      status: "CONVERTED",
      converted_order_id: clean(orderId) || null,
      converted_at: Timestamp.now(),
      updated_at: Timestamp.now(),
    },
    { merge: true }
  );
}

export interface AbandonedLead {
  leadId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
  userId: string | null;
  isGuest: boolean;
  items: Array<{ productId: number; name: string; quantity: number; price: number }>;
  cartTotal: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * List ABANDONED leads, newest activity first. Filters status in memory so no
 * composite Firestore index is required.
 */
export async function listAbandonedCheckouts(max = 300): Promise<AbandonedLead[]> {
  const snap = await collection.where("status", "==", "ABANDONED").limit(1000).get();

  const toIso = (v: unknown): string | null =>
    v instanceof Timestamp ? v.toDate().toISOString() : null;

  const leads: AbandonedLead[] = snap.docs.map((doc) => {
    const x = doc.data() as Record<string, unknown>;
    const addressParts = [x.address_line1, x.address_line2, x.landmark]
      .map((p) => clean(p))
      .filter(Boolean);
    const itemsRaw = Array.isArray(x.items) ? (x.items as Array<Record<string, unknown>>) : [];
    return {
      leadId: doc.id,
      name: clean(x.name) || null,
      phone: clean(x.phone) || null,
      email: clean(x.email) || null,
      address: addressParts.length ? addressParts.join(", ") : null,
      city: clean(x.city) || null,
      state: clean(x.state) || null,
      pincode: clean(x.pincode) || null,
      country: clean(x.country) || null,
      userId: x.user_id ? clean(x.user_id) : null,
      isGuest: !x.user_id,
      items: itemsRaw.map((i) => ({
        productId: Number(i.product_id) || 0,
        name: clean(i.name) || "Product",
        quantity: Number(i.quantity) || 0,
        price: Number(i.price) || 0,
      })),
      cartTotal: Number(x.cart_total) || 0,
      createdAt: toIso(x.created_at),
      updatedAt: toIso(x.updated_at),
    };
  });

  leads.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return leads.slice(0, max);
}
