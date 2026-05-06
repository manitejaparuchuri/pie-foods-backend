import { Request, Response } from "express";
import firestoreCatalogService from "../services/catalog-firestore.service";
import { withCache } from "../config/cache";

const FIVE_MIN = 5 * 60 * 1000;
const PUBLIC_CACHE_HEADER = "public, max-age=60, stale-while-revalidate=300";

export const getAll = async (_req: Request, res: Response) => {
  try {
    const rows = await withCache(
      "catalog:products:all",
      FIVE_MIN,
      () => firestoreCatalogService.getAllProducts()
    );
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    return res.json(rows);
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
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    return res.json(product);
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
    return res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
