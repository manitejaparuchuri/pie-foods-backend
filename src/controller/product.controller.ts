import { Request, Response } from "express";
import firestoreCatalogService from "../services/catalog-firestore.service";

export const getAll = async (_req: Request, res: Response) => {
  try {
    const rows = await firestoreCatalogService.getAllProducts();
    return res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getById = async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.id);
    const product = await firestoreCatalogService.getProductById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    return res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getByCategory = async (req: Request, res: Response) => {
  try {
    const categoryId = Number(req.params.categoryId);
    const rows = await firestoreCatalogService.getProductsByCategory(categoryId);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
