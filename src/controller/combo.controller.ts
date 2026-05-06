import { Request, Response } from "express";
import firestoreCatalogService from "../services/catalog-firestore.service";
import { withCache } from "../config/cache";

const FIVE_MIN = 5 * 60 * 1000;
const PUBLIC_CACHE_HEADER = "public, max-age=60, stale-while-revalidate=300";

const normalizeCombo = (combo: any) => ({
  combo_id: Number(combo.combo_id),
  name: String(combo.name || ""),
  slug: combo.slug ?? null,
  description: combo.description ?? null,
  badge: combo.badge ?? null,
  product_ids: Array.isArray(combo.product_ids)
    ? combo.product_ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
    : [],
  discount_percent: Number(combo.discount_percent) || 0,
  is_active: combo.is_active !== false,
  sort_order: Number(combo.sort_order) || Number(combo.combo_id) || 0,
});

export const getActiveCombos = async (_req: Request, res: Response) => {
  try {
    const combos = await withCache(
      "catalog:combos:active",
      FIVE_MIN,
      () => firestoreCatalogService.getActiveCombos()
    );
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    return res.json(combos.map(normalizeCombo));
  } catch (error) {
    console.error("GET COMBOS ERROR:", error);
    return res.status(500).json({ message: "Unable to fetch combos" });
  }
};
