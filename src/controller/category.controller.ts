import { Request, Response } from "express";
import db from "../config/db";
import { getSelectableProductColumns } from "../utils/product-columns";

const parsePositiveInt = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

export const getAll = async (_req: Request, res: Response) => {
  try {
    const [rows] = await db.query(
      `SELECT category_id, name, description, image_url
       FROM categories
       ORDER BY category_id ASC`
    );

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
    const [rows]: any = await db.query(
      `SELECT category_id, name, description, image_url
       FROM categories
       WHERE category_id = ?
       LIMIT 1`,
      [categoryId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Category not found" });
    }

    return res.json(rows[0]);
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
    const selectColumns = await getSelectableProductColumns("p");
    const [rows] = await db.query(
      `SELECT ${selectColumns.join(", ")}
       FROM products p
       WHERE p.category_id = ?
       ORDER BY p.created_at DESC, p.product_id DESC`,
      [categoryId]
    );

    return res.json({ success: true, products: rows });
  } catch (error) {
    console.error("GET PRODUCTS BY CATEGORY ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error", products: [] });
  }
};

export const getCategoriesWithProducts = async (_req: Request, res: Response) => {
  try {
    const [rows]: any = await db.query(
      `SELECT
        c.category_id,
        c.name AS category_name,
        c.description AS category_description,
        c.image_url AS category_image_url,
        p.product_id,
        p.name AS product_name,
        p.price AS product_price,
        p.image_url AS product_image_url
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.category_id
      ORDER BY c.category_id ASC, p.created_at DESC, p.product_id DESC`
    );

    const byCategory = new Map<number, any>();

    for (const row of rows) {
      if (!byCategory.has(row.category_id)) {
        byCategory.set(row.category_id, {
          category_id: row.category_id,
          name: row.category_name,
          description: row.category_description,
          image_url: row.category_image_url,
          products: [],
        });
      }

      if (row.product_id) {
        byCategory.get(row.category_id).products.push({
          product_id: row.product_id,
          name: row.product_name,
          price: row.product_price,
          image_url: row.product_image_url,
        });
      }
    }

    return res.json(Array.from(byCategory.values()));
  } catch (error) {
    console.error("GET CATEGORIES WITH PRODUCTS ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

