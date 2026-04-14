import { Response } from "express";
import { ResultSetHeader } from "mysql2";
import db from "../config/db";
import { AuthRequest } from "../middlewares/auth";

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const cartSelectQuery = `
  SELECT
    c.cart_item_id,
    c.user_id,
    c.product_id,
    c.quantity,
    c.added_at,
    p.name,
    p.price,
    p.image_url
  FROM cart_items c
  JOIN products p ON p.product_id = c.product_id
`;

const getCartRowsByUser = async (userId: number) => {
  const [rows] = await db.query(
    `${cartSelectQuery}
     WHERE c.user_id = ?
     ORDER BY c.added_at DESC, c.cart_item_id DESC`,
    [userId]
  );
  return rows;
};

const canAccessUserCart = (authUser: AuthRequest["user"], targetUserId: number): boolean => {
  if (!authUser) {
    return false;
  }
  if (authUser.role === "admin") {
    return true;
  }
  return authUser.id === targetUserId;
};

export const getAllCartItems = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const rows = await getCartRowsByUser(userId);
    return res.json(rows);
  } catch (error) {
    console.error("GET ALL CART ITEMS ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getcartByUserIdFromToken = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const rows = await getCartRowsByUser(userId);
    return res.json(rows);
  } catch (error) {
    console.error("GET CART BY TOKEN USER ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getcartByUserId = async (req: AuthRequest, res: Response) => {
  const userId = parsePositiveInt(req.params.user_Id);
  if (!userId) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  if (!canAccessUserCart(req.user, userId)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    const rows = await getCartRowsByUser(userId);
    return res.json(rows);
  } catch (error) {
    console.error("GET CART BY USER ID ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getCartItemById = async (req: AuthRequest, res: Response) => {
  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const cartItemId = parsePositiveInt(req.params.id);
  if (!cartItemId) {
    return res.status(400).json({ message: "Invalid cart item id" });
  }

  try {
    const isAdmin = authUser.role === "admin";
    const [rows]: any = await db.query(
      `${cartSelectQuery}
       WHERE c.cart_item_id = ?
       ${isAdmin ? "" : "AND c.user_id = ?"}
       LIMIT 1`,
      isAdmin ? [cartItemId] : [cartItemId, authUser.id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error("GET CART ITEM BY ID ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const addCartItem = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const productId = parsePositiveInt(req.body?.productId ?? req.body?.product_id);
  const quantity = parsePositiveInt(req.body?.quantity ?? 1);

  if (!productId || !quantity) {
    return res.status(400).json({ message: "productId and quantity are required" });
  }

  try {
    const [productRows]: any = await db.query(
      "SELECT product_id FROM products WHERE product_id = ? LIMIT 1",
      [productId]
    );

    if (!productRows.length) {
      return res.status(404).json({ message: "Product not found" });
    }

    const [existingRows]: any = await db.query(
      `SELECT cart_item_id, quantity
       FROM cart_items
       WHERE user_id = ? AND product_id = ?
       LIMIT 1`,
      [userId, productId]
    );

    if (existingRows.length) {
      const existing = existingRows[0];
      const updatedQuantity = Number(existing.quantity) + quantity;

      await db.query(
        "UPDATE cart_items SET quantity = ? WHERE cart_item_id = ?",
        [updatedQuantity, existing.cart_item_id]
      );

      return res.json({
        message: "Cart item updated",
        cart_item_id: existing.cart_item_id,
        quantity: updatedQuantity,
      });
    }

    const [insertResult] = await db.query<ResultSetHeader>(
      `INSERT INTO cart_items (user_id, product_id, quantity)
       VALUES (?, ?, ?)`,
      [userId, productId, quantity]
    );

    return res.status(201).json({
      message: "Cart item added",
      cart_item_id: insertResult.insertId,
      quantity,
    });
  } catch (error) {
    console.error("ADD CART ITEM ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateCartItem = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const cartItemId = parsePositiveInt(req.params.id);
  const quantity = parsePositiveInt(req.body?.quantity);

  if (!cartItemId || !quantity) {
    return res.status(400).json({ message: "Valid cart item id and quantity are required" });
  }

  try {
    const [result] = await db.query<ResultSetHeader>(
      "UPDATE cart_items SET quantity = ? WHERE cart_item_id = ? AND user_id = ?",
      [quantity, cartItemId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    return res.json({
      message: "Cart item updated",
      cart_item_id: cartItemId,
      quantity,
    });
  } catch (error) {
    console.error("UPDATE CART ITEM ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const deleteCartItem = async (req: AuthRequest, res: Response) => {
  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const cartItemId = parsePositiveInt(req.params.id ?? req.params.cart_item_id);
  const userIdParam = parsePositiveInt(req.params.user_id);
  const productIdParam = parsePositiveInt(req.params.product_id);

  try {
    if (cartItemId) {
      const [result] = await db.query<ResultSetHeader>(
        "DELETE FROM cart_items WHERE cart_item_id = ? AND user_id = ?",
        [cartItemId, authUser.id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Cart item not found" });
      }

      return res.json({ message: "Cart item removed" });
    }

    if (!userIdParam || !productIdParam) {
      return res.status(400).json({ message: "Invalid delete parameters" });
    }

    if (!canAccessUserCart(authUser, userIdParam)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const [result] = await db.query<ResultSetHeader>(
      "DELETE FROM cart_items WHERE user_id = ? AND product_id = ?",
      [userIdParam, productIdParam]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    return res.json({ message: "Cart item removed" });
  } catch (error) {
    console.error("DELETE CART ITEM ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

