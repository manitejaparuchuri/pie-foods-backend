import { Request, Response } from "express";
import firestoreCatalogService from "../services/catalog-firestore.service";
import { withCache } from "../config/cache";

const FIVE_MIN = 5 * 60 * 1000;
const PUBLIC_CACHE_HEADER = "public, max-age=60, stale-while-revalidate=300";

/**
 * Cap for public stock disclosure. Values at or above this are reported as
 * exactly this number ("N+ in stock" effectively), so competitors can't
 * scrape our raw inventory levels or compute sales velocity by diffing polls.
 * Below the cap we keep exact counts so the storefront's "Only X left in
 * stock" UX still works. `0` remains `0` so sold-out badges keep flipping.
 */
const PUBLIC_STOCK_CAP = 10;

/**
 * Fields the public API must NEVER return. Admin-only endpoints use different
 * controllers and still see the raw row. Keeping this list here (not
 * whitelist) makes it easy to add new admin-only fields without accidentally
 * exposing them.
 */
type PublicProduct = Omit<
  ReturnType<typeof identity>,
  "is_active" | "created_at" | "updated_at"
>;
function identity<T>(x: T): T { return x; }

function toPublicProduct(row: any): PublicProduct {
  const {
    // Strip admin-only fields from the response.
    is_active: _isActive,
    created_at: _createdAt,
    updated_at: _updatedAt,
    stock_quantity,
    ...rest
  } = row;

  const rawStock = Number(stock_quantity);
  const capped =
    Number.isFinite(rawStock) && rawStock > 0
      ? Math.min(rawStock, PUBLIC_STOCK_CAP)
      : 0;

  return { ...rest, stock_quantity: capped } as PublicProduct;
}

export const getAll = async (_req: Request, res: Response) => {
  try {
    const rows = await withCache(
      "catalog:products:all",
      FIVE_MIN,
      () => firestoreCatalogService.getAllProducts()
    );
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    // Filter out unpublished items and strip admin-only fields before serving.
    const publicRows = rows
      .filter((p: any) => p?.is_active !== false)
      .map(toPublicProduct);
    return res.json(publicRows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getById = async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ message: "Invalid product id" });
    }
    const product = await withCache(
      `catalog:products:byId:${productId}`,
      FIVE_MIN,
      () => firestoreCatalogService.getProductById(productId)
    );
    // Treat "unpublished" the same as "does not exist" for public callers —
    // otherwise draft/hidden products can be enumerated by sequential ID.
    if (!product || (product as any).is_active === false) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    return res.json(toPublicProduct(product));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getByCategory = async (req: Request, res: Response) => {
  try {
    const categoryId = Number(req.params.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return res.status(400).json({ message: "Invalid category id" });
    }
    const rows = await withCache(
      `catalog:products:byCategory:${categoryId}`,
      FIVE_MIN,
      () => firestoreCatalogService.getProductsByCategory(categoryId)
    );
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    // getProductsByCategory already filters is_active=true at the query level,
    // but strip admin-only fields for defence-in-depth.
    return res.json(rows.map(toPublicProduct));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
