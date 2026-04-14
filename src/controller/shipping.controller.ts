import { Response } from "express";
import db from "../config/db";
import { generateShippingId } from "../utils/files";
import { AuthRequest } from "../middlewares/auth";

/**
 * ADD SHIPPING ADDRESS
 */
export const addShippingAddress = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      address,
      city,
      state,
      postal_code,
      country,
      phone
    } = req.body;

    if (!address || !city || !state || !postal_code) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const shipping_id = generateShippingId();

    const sql = `
      INSERT INTO shipping_info
      (shipping_id, user_id, address, city, state, postal_code, country, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.query(sql, [
      shipping_id,
      userId,
      address,
      city,
      state,
      postal_code,
      country ?? "India",
      phone ?? null
    ]);

    return res.status(201).json({
      message: "Shipping address added",
      shipping_id
    });
  } catch (err: any) {
    console.error("ADD SHIPPING ERROR:", err);
    return res.status(500).json({ error: "Failed to save shipping address" });
  }
};

/**
 * GET SHIPPING FOR LOGGED-IN USER
 */
export const getShippingByUser = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [rows] = await db.execute(
      `SELECT * FROM shipping_info WHERE user_id = ?`,
      [userId]
    );

    res.json(rows);
  } catch (error: any) {
    console.error("GET SHIPPING ERROR:", error);
    res.status(500).json({ error: "Failed to load shipping addresses" });
  }
};
