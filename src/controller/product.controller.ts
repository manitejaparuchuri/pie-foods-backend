import { Request, Response } from 'express';
import pool from '../config/db';
import { getSelectableProductColumns } from '../utils/product-columns';

export const getAll = async (_req: Request, res: Response) => {
  try {
    const selectColumns = await getSelectableProductColumns("p");
    const [rows] = await pool.query(
      `SELECT ${selectColumns.join(", ")}, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.category_id = p.category_id
       ORDER BY p.created_at DESC, p.product_id DESC`
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getById = async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.id);
    const selectColumns = await getSelectableProductColumns('p');

    const [rows]: any = await pool.query(
      `SELECT ${selectColumns.join(", ")}, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.category_id = p.category_id
       WHERE p.product_id = ?`,
      [productId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getByCategory = async (req: Request, res: Response) => {
  try {
    const categoryId = Number(req.params.categoryId);
    const selectColumns = await getSelectableProductColumns('p');

    const [rows] = await pool.query(
      `SELECT ${selectColumns.join(", ")}, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.category_id = p.category_id
       WHERE p.category_id = ?
       ORDER BY p.created_at DESC, p.product_id DESC`,
      [categoryId]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};
