import { Request, Response } from "express";
import firestoreCatalogService from "../services/catalog-firestore.service";
import { withCache } from "../config/cache";

const FIVE_MIN = 5 * 60 * 1000;
const PUBLIC_CACHE_HEADER = "public, max-age=60, stale-while-revalidate=300";

const parsePositiveInt = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

export const getAll = async (_req: Request, res: Response) => {
  try {
    const rows = await withCache(
      "catalog:categories:all",
      FIVE_MIN,
      () => firestoreCatalogService.getAllCategories()
    );
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    return res.json(rows);
  } catch (error) {
    console.error("GET CATEGORIES ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getById = async (req: Request, res: Response) => {
  const categoryId = parsePositiveInt(req.params.id);
  if (!categoryId) {
    return res.status(400).json({ message: "Invalid category id" });
  }

  try {
    const category = await withCache(
      `catalog:categories:byId:${categoryId}`,
      FIVE_MIN,
      () => firestoreCatalogService.getCategoryById(categoryId)
    );
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    return res.json(category);
  } catch (error) {
    console.error("GET CATEGORY BY ID ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getProductsByCategory = async (req: Request, res: Response) => {
  const categoryId = parsePositiveInt(req.params.id);
  if (!categoryId) {
    return res.status(400).json({ success: false, message: "Invalid category id" });
  }

  try {
    const rows = await withCache(
      `catalog:products:byCategory:${categoryId}`,
      FIVE_MIN,
      () => firestoreCatalogService.getProductsByCategory(categoryId)
    );
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    return res.json({ success: true, products: rows });
  } catch (error) {
    console.error("GET PRODUCTS BY CATEGORY ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error", products: [] });
  }
};

export const getCategoriesWithProducts = async (_req: Request, res: Response) => {
  try {
    const rows = await withCache(
      "catalog:categories:withProducts",
      FIVE_MIN,
      () => firestoreCatalogService.getCategoriesWithProducts()
    );
    res.set("Cache-Control", PUBLIC_CACHE_HEADER);
    return res.json(rows);
  } catch (error) {
    console.error("GET CATEGORIES WITH PRODUCTS ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
