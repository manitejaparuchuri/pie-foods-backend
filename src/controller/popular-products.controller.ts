import { Request, Response } from "express";
import firestoreCatalogService from "../services/catalog-firestore.service";
import { withCache } from "../config/cache";

const FIVE_MIN = 5 * 60 * 1000;
const PUBLIC_CACHE_HEADER = "public, max-age=60, stale-while-revalidate=300";

const normalizePopularShowcase = (showcase: any) => ({
  section_id: String(showcase.section_id || "main"),
  eyebrow: String(showcase.eyebrow || "Curated Selection"),
  title: String(showcase.title || "Popular Products"),
  is_active: showcase.is_active !== false,
  items: Array.isArray(showcase.items)
    ? showcase.items
        .map((item: any) => ({
          item_id: Number(item.item_id),
          name: String(item.name || ""),
          tagline: item.tagline ?? null,
          caption: item.caption ?? null,
          button_text: item.button_text ?? null,
          link: item.link ?? null,
          image_url: item.image_url ?? null,
          is_featured: item.is_featured === true,
          is_active: item.is_active !== false,
          sort_order: Number(item.sort_order) || Number(item.item_id) || 0,
        }))
        .filter((item: any) => item.name && item.image_url && item.is_active)
    : [],
});

export const getPopularProductShowcase = async (_req: Request, res: Response) => {
  try {
    const showcase = await withCache(
      "catalog:popular:active",
      FIVE_MIN,
      () => firestoreCatalogService.getPopularProductShowcase()
    );
    const normalized = normalizePopularShowcase(showcase);
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);

    if (!normalized.is_active) {
      return res.json({ ...normalized, items: [] });
    }
    return res.json(normalized);
  } catch (error) {
    console.error("GET POPULAR PRODUCTS ERROR:", error);
    return res.status(500).json({ message: "Unable to fetch popular products" });
  }
};
