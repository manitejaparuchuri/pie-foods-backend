import { Request, Response } from "express";
import firestoreCatalogService from "../services/catalog-firestore.service";
import { withCache } from "../config/cache";

const FIVE_MIN = 5 * 60 * 1000;
const PUBLIC_CACHE_HEADER = "public, max-age=60, stale-while-revalidate=300";

const normalizeBanner = (banner: any) => ({
  banner_id: Number(banner.banner_id),
  slug: banner.slug ?? null,
  image_url: banner.image_url ?? null,
  caption: String(banner.caption || ""),
  title_top: String(banner.title_top || ""),
  title_accent: String(banner.title_accent || ""),
  title_bottom: banner.title_bottom ?? null,
  description: banner.description ?? null,
  chips: Array.isArray(banner.chips) ? banner.chips : [],
  primary_cta: banner.primary_cta || { text: "Shop Now", link: "/products" },
  secondary_cta: banner.secondary_cta ?? null,
  align: banner.align === "right" ? "right" : "left",
  is_active: banner.is_active !== false,
  sort_order: Number(banner.sort_order) || Number(banner.banner_id) || 0,
});

export const getActiveBanners = async (_req: Request, res: Response) => {
  try {
    const banners = await withCache(
      "catalog:banners:active",
      FIVE_MIN,
      () => firestoreCatalogService.getActiveBanners()
    );
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    return res.json(banners.map(normalizeBanner));
  } catch (error) {
    console.error("GET BANNERS ERROR:", error);
    return res.status(500).json({ message: "Unable to fetch banners" });
  }
};
