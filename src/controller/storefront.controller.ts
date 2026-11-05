import { Request, Response } from "express";

import { withCache } from "../config/cache";
import firestoreCatalogService from "../services/catalog-firestore.service";
import { INCLUSIVE_GST_RATE, ORDER_DISCOUNT_RATE } from "../services/pricing.service";

const FIVE_MIN = 5 * 60 * 1000;
const PUBLIC_CACHE_HEADER = "public, max-age=60, stale-while-revalidate=300";

const normalizeTrialPack = (trialPack: any) => ({
  price: Number(trialPack.price) || 0,
  currency: String(trialPack.currency || "₹"),
  unit_label: String(trialPack.unit_label || "10 sachets"),
  pack_label: String(trialPack.pack_label || "trial pack"),
  cups_label: String(trialPack.cups_label || "10 cups of chai"),
  is_active: trialPack.is_active !== false,
});

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeAnnouncement = (a: any) => ({
  enabled: a.enabled !== false,
  message: String(a.message || ""),
  coupon_code: String(a.coupon_code || "").toUpperCase(),
  cta_label: String(a.cta_label || ""),
  cta_link: String(a.cta_link || ""),
});

const versionOf = (value: unknown): string => {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : "default";
};

/** Public popup payload. A product destination is linked by the product's
 *  CURRENT slug (slugs are rebuilt from the name on every save), and the
 *  popup is switched off if that product is missing or hidden, so it can
 *  never send shoppers to a "Product not found" page. Other destinations are
 *  site paths the admin entered. `version` changes on every admin save, so
 *  visitors see an updated popup even if they closed the previous one. */
const normalizeHomePopup = (popup: any, product: any) => {
  let link = "";
  let productName = "";
  if (popup.product_id) {
    const slug = String(product?.slug || "").trim();
    if (product && product.is_active !== false && slug) {
      link = `/products/${slug}`;
      productName = String(product.name || "");
    }
  } else if (typeof popup.link_path === "string" && /^\/(?!\/)/.test(popup.link_path)) {
    link = popup.link_path;
  }
  const live = Boolean(popup.enabled && popup.image_url && link);
  return {
    enabled: live,
    image_url: live ? String(popup.image_url) : "",
    mobile_image_url: live ? String(popup.mobile_image_url || "") : "",
    link: live ? link : "",
    product_name: live ? productName : "",
    cta_label: String(popup.cta_label || "Shop Now"),
    version: versionOf(popup.updated_at),
  };
};

export const getStorefrontSettings = async (_req: Request, res: Response) => {
  try {
    const [trialPack, shippingConfig, announcement] = await Promise.all([
      withCache("catalog:storefront:trial-pack", FIVE_MIN, () =>
        firestoreCatalogService.getTrialPack()
      ),
      withCache("catalog:storefront:shipping", FIVE_MIN, () =>
        firestoreCatalogService.getShippingConfig()
      ),
      withCache("catalog:storefront:announcement", FIVE_MIN, () =>
        firestoreCatalogService.getAnnouncement()
      ),
    ]);
    const homePopup = await withCache("catalog:storefront:home-popup", FIVE_MIN, async () => {
      const popup = await firestoreCatalogService.getHomePopup();
      const product = popup.product_id
        ? await firestoreCatalogService.getProductById(popup.product_id)
        : null;
      return normalizeHomePopup(popup, product);
    });

    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    return res.json({
      order_discount_percent: round2(ORDER_DISCOUNT_RATE * 100),
      // Prices are INCLUSIVE of GST — 5% is embedded inside the listed price,
      // not added on top. The frontend uses this only for invoice-style display.
      gst_percent: round2(INCLUSIVE_GST_RATE * 100),
      gst_inclusive: true,
      // Shipping knobs the storefront uses to preview delivery charges. The
      // backend remains the source of truth for the actually-charged total.
      shipping_fee: Number(shippingConfig.shipping_fee),
      free_shipping_threshold: Number(shippingConfig.free_shipping_threshold),
      cod_surcharge: Number(shippingConfig.cod_surcharge),
      trial_pack: normalizeTrialPack(trialPack),
      // Admin-editable top announcement bar / welcome-offer.
      announcement: normalizeAnnouncement(announcement),
      // Admin-editable home page offer popup (Admin → Home Popup).
      home_popup: homePopup,
    });
  } catch (error) {
    console.error("GET STOREFRONT SETTINGS ERROR:", error);
    return res.status(500).json({ message: "Unable to fetch storefront settings" });
  }
};
