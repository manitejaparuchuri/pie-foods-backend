import { Request, Response } from "express";
import { unlink } from "fs/promises";
import db from "../config/db";
import { isR2Configured, uploadFileToR2 } from "../config/r2";
import {
  getAvailableProductImageFields,
  getSelectableProductColumns,
  getUpdatableProductTextColumns,
  getWritableProductColumns,
} from "../utils/product-columns";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const ADMIN_TOKEN_USER_ID = 0;

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const parseNonNegativeInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const parseNonNegativeNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const parseBooleanFlag = (value: unknown): number | null => {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return 1;
  }
  if (normalized === "0" || normalized === "false") {
    return 0;
  }
  return null;
};

const parseOptionalDate = (value: unknown): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || String(value).trim() === "") {
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString().slice(0, 19).replace("T", " ");
};

const normalizeCouponCode = (value: unknown): string => {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
};

const isEqualSecret = (provided: string, expected: string): boolean => {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
};

export const adminLogin = async (req: Request, res: Response) => {
  const username = String(req.body?.username || req.body?.email || "").trim();
  const password = String(req.body?.password || "");
  const configuredUsername = String(process.env.ADMIN_ID || "").trim();
  const configuredPassword = String(process.env.ADMIN_PASSWORD || "").trim();

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }

  if (
    !configuredUsername ||
    !configuredPassword ||
    username.toLowerCase() !== configuredUsername.toLowerCase() ||
    !isEqualSecret(password, configuredPassword)
  ) {
    return res.status(401).json({ message: "Invalid admin credentials" });
  }

  const token = jwt.sign(
    {
      id: ADMIN_TOKEN_USER_ID,
      role: "admin",
      username: configuredUsername,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "12h" }
  );

  return res.json({
    message: "Admin login successful",
    token,
    admin: {
      username: configuredUsername,
      role: "admin",
    },
  });
};

export const getAdminBootstrap = async (_req: Request, res: Response) => {
  try {
    const selectColumns = await getSelectableProductColumns();
    const productImageFields = await getAvailableProductImageFields();
    const writableProductColumns = await getWritableProductColumns();

    const [categoryRows, productRows, couponRows] = await Promise.all([
      db.query(
        `SELECT
          c.category_id,
          c.name,
          c.description,
          c.image_url,
          COUNT(p.product_id) AS product_count
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.category_id
         GROUP BY c.category_id, c.name, c.description, c.image_url
         ORDER BY c.category_id ASC`
      ),
      db.query(
        `SELECT ${selectColumns.join(", ")}
         FROM products
         ORDER BY created_at DESC, product_id DESC`
      ),
      db.query(
        `SELECT
          coupon_id,
          code,
          description,
          discount_type,
          discount_value,
          max_discount_amount,
          min_order_amount,
          starts_at,
          expires_at,
          usage_limit_total,
          usage_limit_per_user,
          used_count,
          is_active,
          created_at,
          updated_at
        FROM coupons
        ORDER BY coupon_id DESC`
      ),
    ]);

    return res.json({
      categories: categoryRows[0],
      products: productRows[0],
      coupons: couponRows[0],
      productImageFields,
      supportsProductActive: writableProductColumns.includes("is_active"),
    });
  } catch (error) {
    console.error("ADMIN BOOTSTRAP ERROR:", error);
    return res.status(500).json({ message: "Unable to load admin data" });
  }
};

export const createCategory = async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim();
  const imageUrl = String(req.body?.image_url || "").trim();

  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  try {
    const [result]: any = await db.query(
      `INSERT INTO categories (name, description, image_url)
       VALUES (?, ?, ?)`,
      [name, description || null, imageUrl || null]
    );

    const [rows]: any = await db.query(
      `SELECT category_id, name, description, image_url
       FROM categories
       WHERE category_id = ?
       LIMIT 1`,
      [result.insertId]
    );

    return res.status(201).json({ message: "Category created", category: rows[0] });
  } catch (error) {
    console.error("CREATE CATEGORY ERROR:", error);
    return res.status(500).json({ message: "Unable to create category" });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  const categoryId = parsePositiveInt(req.params.id);
  if (!categoryId) {
    return res.status(400).json({ message: "Invalid category id" });
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ message: "name cannot be empty" });
    }
    fields.push("name = ?");
    values.push(name);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "description")) {
    const description = String(req.body?.description || "").trim();
    fields.push("description = ?");
    values.push(description || null);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "image_url")) {
    const imageUrl = String(req.body?.image_url || "").trim();
    fields.push("image_url = ?");
    values.push(imageUrl || null);
  }

  if (!fields.length) {
    return res.status(400).json({ message: "No valid fields provided for update" });
  }

  try {
    values.push(categoryId);
    const [result]: any = await db.query(
      `UPDATE categories SET ${fields.join(", ")} WHERE category_id = ?`,
      values
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Category not found" });
    }

    const [rows]: any = await db.query(
      `SELECT category_id, name, description, image_url
       FROM categories
       WHERE category_id = ?
       LIMIT 1`,
      [categoryId]
    );

    return res.json({ message: "Category updated", category: rows[0] });
  } catch (error) {
    console.error("UPDATE CATEGORY ERROR:", error);
    return res.status(500).json({ message: "Unable to update category" });
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  const categoryId = parsePositiveInt(req.params.id);
  if (!categoryId) {
    return res.status(400).json({ message: "Invalid category id" });
  }

  try {
    const [productRows]: any = await db.query(
      `SELECT COUNT(*) AS product_count
       FROM products
       WHERE category_id = ?`,
      [categoryId]
    );

    const productCount = Number(productRows?.[0]?.product_count || 0);

    if (productCount > 0) {
      return res.status(400).json({
        message: "Cannot delete category with existing products",
        productCount,
      });
    }

    const [result]: any = await db.query(
      "DELETE FROM categories WHERE category_id = ?",
      [categoryId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Category not found" });
    }

    return res.json({ message: "Category deleted" });
  } catch (error) {
    console.error("DELETE CATEGORY ERROR:", error);
    return res.status(500).json({ message: "Unable to delete category" });
  }
};

export const createProduct = async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const categoryId = parsePositiveInt(req.body?.category_id);
  const price = parseNonNegativeNumber(req.body?.price);
  const stockQuantity = parseNonNegativeInt(req.body?.stock_quantity);

  if (!name || !categoryId || price === null || stockQuantity === null) {
    return res.status(400).json({
      message: "name, category_id, price and stock_quantity are required",
    });
  }

  try {
    const [categories]: any = await db.query(
      "SELECT category_id FROM categories WHERE category_id = ? LIMIT 1",
      [categoryId]
    );

    if (!categories.length) {
      return res.status(400).json({ message: "Invalid category_id" });
    }

    const insertColumns = [...(await getWritableProductColumns())];
    const insertValues = insertColumns.map((column) => {
      switch (column) {
        case "name":
          return name;
        case "price":
          return price;
        case "stock_quantity":
          return stockQuantity;
        case "category_id":
          return categoryId;
        case "is_active": {
          const isActive =
            req.body?.is_active === undefined ? 1 : parseBooleanFlag(req.body?.is_active);
          return isActive === null ? 1 : isActive;
        }
        default:
          return String(req.body?.[column] || "").trim() || null;
      }
    });

    const [result]: any = await db.query(
      `INSERT INTO products (${insertColumns.join(", ")})
       VALUES (${insertColumns.map(() => "?").join(", ")})`,
      insertValues
    );

    const selectColumns = await getSelectableProductColumns();
    const [rows]: any = await db.query(
      `SELECT ${selectColumns.join(", ")}
       FROM products
       WHERE product_id = ?
       LIMIT 1`,
      [result.insertId]
    );

    return res.status(201).json({ message: "Product created", product: rows[0] });
  } catch (error) {
    console.error("CREATE PRODUCT ERROR:", error);
    return res.status(500).json({ message: "Unable to create product" });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  const productId = parsePositiveInt(req.params.id);
  if (!productId) {
    return res.status(400).json({ message: "Invalid product id" });
  }

  const fields: string[] = [];
  const values: any[] = [];
  const writableProductColumns = new Set(await getWritableProductColumns());

  if (Object.prototype.hasOwnProperty.call(req.body, "price")) {
    const price = parseNonNegativeNumber(req.body?.price);
    if (price === null) {
      return res.status(400).json({ message: "Invalid price" });
    }
    fields.push("price = ?");
    values.push(price);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "stock_quantity")) {
    const stockQuantity = parseNonNegativeInt(req.body?.stock_quantity);
    if (stockQuantity === null) {
      return res.status(400).json({ message: "Invalid stock_quantity" });
    }
    fields.push("stock_quantity = ?");
    values.push(stockQuantity);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "category_id")) {
    const categoryId = parsePositiveInt(req.body?.category_id);
    if (!categoryId) {
      return res.status(400).json({ message: "Invalid category_id" });
    }

    const [categories]: any = await db.query(
      "SELECT category_id FROM categories WHERE category_id = ? LIMIT 1",
      [categoryId]
    );
    if (!categories.length) {
      return res.status(400).json({ message: "Invalid category_id" });
    }

    fields.push("category_id = ?");
    values.push(categoryId);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "is_active")) {
    if (!writableProductColumns.has("is_active")) {
      return res.status(400).json({ message: "Product active status is not supported by this schema" });
    }
    const isActive = parseBooleanFlag(req.body?.is_active);
    if (isActive === null) {
      return res.status(400).json({ message: "Invalid is_active value" });
    }
    fields.push("is_active = ?");
    values.push(isActive);
  }

  const productTextFields = await getUpdatableProductTextColumns();

  for (const key of productTextFields) {
    if (!Object.prototype.hasOwnProperty.call(req.body, key)) {
      continue;
    }

    if (key === "name") {
      const name = String(req.body?.name || "").trim();
      if (!name) {
        return res.status(400).json({ message: "name cannot be empty" });
      }
      fields.push("name = ?");
      values.push(name);
      continue;
    }

    const textValue = String(req.body?.[key] || "").trim();
    fields.push(`${key} = ?`);
    values.push(textValue || null);
  }

  if (!fields.length) {
    return res.status(400).json({ message: "No valid fields provided for update" });
  }

  try {
    values.push(productId);
    const [result]: any = await db.query(
      `UPDATE products SET ${fields.join(", ")} WHERE product_id = ?`,
      values
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Product not found" });
    }

    const selectColumns = await getSelectableProductColumns();
    const [rows]: any = await db.query(
      `SELECT ${selectColumns.join(", ")}
       FROM products
       WHERE product_id = ?
       LIMIT 1`,
      [productId]
    );

    return res.json({ message: "Product updated", product: rows[0] });
  } catch (error) {
    console.error("UPDATE PRODUCT ERROR:", error);
    return res.status(500).json({ message: "Unable to update product" });
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  const productId = parsePositiveInt(req.params.id);
  if (!productId) {
    return res.status(400).json({ message: "Invalid product id" });
  }

  try {
    const [result]: any = await db.query(
      "DELETE FROM products WHERE product_id = ?",
      [productId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.json({ message: "Product deleted" });
  } catch (error) {
    console.error("DELETE PRODUCT ERROR:", error);
    return res.status(500).json({ message: "Unable to delete product" });
  }
};

export const getCoupons = async (_req: Request, res: Response) => {
  try {
    const [rows] = await db.query(
      `SELECT
        coupon_id,
        code,
        description,
        discount_type,
        discount_value,
        max_discount_amount,
        min_order_amount,
        starts_at,
        expires_at,
        usage_limit_total,
        usage_limit_per_user,
        used_count,
        is_active,
        created_at,
        updated_at
      FROM coupons
      ORDER BY coupon_id DESC`
    );
    return res.json(rows);
  } catch (error) {
    console.error("GET COUPONS ERROR:", error);
    return res.status(500).json({ message: "Unable to fetch coupons" });
  }
};

export const getCouponById = async (req: Request, res: Response) => {
  const couponId = parsePositiveInt(req.params.id);
  if (!couponId) {
    return res.status(400).json({ message: "Invalid coupon id" });
  }

  try {
    const [rows]: any = await db.query(
      `SELECT
        coupon_id,
        code,
        description,
        discount_type,
        discount_value,
        max_discount_amount,
        min_order_amount,
        starts_at,
        expires_at,
        usage_limit_total,
        usage_limit_per_user,
        used_count,
        is_active,
        created_at,
        updated_at
      FROM coupons
      WHERE coupon_id = ?
      LIMIT 1`,
      [couponId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Coupon not found" });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error("GET COUPON BY ID ERROR:", error);
    return res.status(500).json({ message: "Unable to fetch coupon" });
  }
};

export const createCoupon = async (req: Request, res: Response) => {
  const code = normalizeCouponCode(req.body?.code);
  const description = String(req.body?.description || "").trim();
  const discountType = String(req.body?.discount_type || "").trim().toUpperCase();
  const discountValue = parseNonNegativeNumber(req.body?.discount_value);
  const maxDiscountAmount =
    req.body?.max_discount_amount === undefined || req.body?.max_discount_amount === null
      ? null
      : parseNonNegativeNumber(req.body?.max_discount_amount);
  const minOrderAmount =
    req.body?.min_order_amount === undefined || req.body?.min_order_amount === null
      ? 0
      : parseNonNegativeNumber(req.body?.min_order_amount);
  const usageLimitTotal =
    req.body?.usage_limit_total === undefined || req.body?.usage_limit_total === null
      ? null
      : parsePositiveInt(req.body?.usage_limit_total);
  const usageLimitPerUser =
    req.body?.usage_limit_per_user === undefined || req.body?.usage_limit_per_user === null
      ? null
      : parsePositiveInt(req.body?.usage_limit_per_user);
  const startsAt = parseOptionalDate(req.body?.starts_at);
  const expiresAt = parseOptionalDate(req.body?.expires_at);
  const isActive =
    req.body?.is_active === undefined ? 1 : parseBooleanFlag(req.body?.is_active);

  if (!code) {
    return res.status(400).json({ message: "code is required" });
  }
  if (discountType !== "PERCENT" && discountType !== "FIXED") {
    return res.status(400).json({ message: "discount_type must be PERCENT or FIXED" });
  }
  if (discountValue === null || discountValue <= 0) {
    return res.status(400).json({ message: "discount_value must be greater than 0" });
  }
  if (discountType === "PERCENT" && discountValue > 100) {
    return res.status(400).json({ message: "For PERCENT, discount_value cannot exceed 100" });
  }
  if (minOrderAmount === null) {
    return res.status(400).json({ message: "Invalid min_order_amount" });
  }
  if (maxDiscountAmount === undefined) {
    return res.status(400).json({ message: "Invalid max_discount_amount" });
  }
  if (usageLimitTotal === undefined) {
    return res.status(400).json({ message: "Invalid usage_limit_total" });
  }
  if (usageLimitPerUser === undefined) {
    return res.status(400).json({ message: "Invalid usage_limit_per_user" });
  }
  if (startsAt === undefined) {
    return res.status(400).json({ message: "Invalid starts_at" });
  }
  if (expiresAt === undefined) {
    return res.status(400).json({ message: "Invalid expires_at" });
  }
  if (isActive === null) {
    return res.status(400).json({ message: "is_active must be true/false or 1/0" });
  }
  if (discountType === "FIXED" && maxDiscountAmount !== null) {
    return res.status(400).json({ message: "max_discount_amount is only allowed for PERCENT coupons" });
  }
  if (
    startsAt &&
    expiresAt &&
    new Date(startsAt).getTime() > new Date(expiresAt).getTime()
  ) {
    return res.status(400).json({ message: "starts_at cannot be after expires_at" });
  }

  try {
    const [result]: any = await db.query(
      `INSERT INTO coupons
      (
        code, description, discount_type, discount_value, max_discount_amount, min_order_amount,
        starts_at, expires_at, usage_limit_total, usage_limit_per_user, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        description || null,
        discountType,
        discountValue,
        maxDiscountAmount,
        minOrderAmount,
        startsAt,
        expiresAt,
        usageLimitTotal,
        usageLimitPerUser,
        isActive,
      ]
    );

    const [rows]: any = await db.query(
      `SELECT
        coupon_id, code, description, discount_type, discount_value, max_discount_amount,
        min_order_amount, starts_at, expires_at, usage_limit_total, usage_limit_per_user,
        used_count, is_active, created_at, updated_at
      FROM coupons
      WHERE coupon_id = ?
      LIMIT 1`,
      [result.insertId]
    );

    return res.status(201).json({ message: "Coupon created", coupon: rows[0] });
  } catch (error: any) {
    console.error("CREATE COUPON ERROR:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Coupon code already exists" });
    }
    return res.status(500).json({ message: "Unable to create coupon" });
  }
};

export const updateCoupon = async (req: Request, res: Response) => {
  const couponId = parsePositiveInt(req.params.id);
  if (!couponId) {
    return res.status(400).json({ message: "Invalid coupon id" });
  }

  try {
    const [existingRows]: any = await db.query(
      `SELECT
        coupon_id, code, description, discount_type, discount_value, max_discount_amount,
        min_order_amount, starts_at, expires_at, usage_limit_total, usage_limit_per_user, is_active
      FROM coupons
      WHERE coupon_id = ?
      LIMIT 1`,
      [couponId]
    );

    if (!existingRows.length) {
      return res.status(404).json({ message: "Coupon not found" });
    }

    const current = existingRows[0];
    const nextCode = Object.prototype.hasOwnProperty.call(req.body, "code")
      ? normalizeCouponCode(req.body?.code)
      : String(current.code);
    const nextDiscountType = Object.prototype.hasOwnProperty.call(req.body, "discount_type")
      ? String(req.body?.discount_type || "").trim().toUpperCase()
      : String(current.discount_type).toUpperCase();
    const nextDiscountValue = Object.prototype.hasOwnProperty.call(req.body, "discount_value")
      ? parseNonNegativeNumber(req.body?.discount_value)
      : Number(current.discount_value);
    const nextMaxDiscountAmount = Object.prototype.hasOwnProperty.call(req.body, "max_discount_amount")
      ? req.body?.max_discount_amount === null || String(req.body?.max_discount_amount).trim() === ""
        ? null
        : parseNonNegativeNumber(req.body?.max_discount_amount)
      : current.max_discount_amount === null
        ? null
        : Number(current.max_discount_amount);
    const nextMinOrderAmount = Object.prototype.hasOwnProperty.call(req.body, "min_order_amount")
      ? parseNonNegativeNumber(req.body?.min_order_amount)
      : Number(current.min_order_amount);
    const nextUsageLimitTotal = Object.prototype.hasOwnProperty.call(req.body, "usage_limit_total")
      ? req.body?.usage_limit_total === null || String(req.body?.usage_limit_total).trim() === ""
        ? null
        : parsePositiveInt(req.body?.usage_limit_total)
      : current.usage_limit_total;
    const nextUsageLimitPerUser = Object.prototype.hasOwnProperty.call(req.body, "usage_limit_per_user")
      ? req.body?.usage_limit_per_user === null || String(req.body?.usage_limit_per_user).trim() === ""
        ? null
        : parsePositiveInt(req.body?.usage_limit_per_user)
      : current.usage_limit_per_user;
    const nextStartsAt = Object.prototype.hasOwnProperty.call(req.body, "starts_at")
      ? parseOptionalDate(req.body?.starts_at)
      : parseOptionalDate(current.starts_at);
    const nextExpiresAt = Object.prototype.hasOwnProperty.call(req.body, "expires_at")
      ? parseOptionalDate(req.body?.expires_at)
      : parseOptionalDate(current.expires_at);
    const nextIsActive = Object.prototype.hasOwnProperty.call(req.body, "is_active")
      ? parseBooleanFlag(req.body?.is_active)
      : Number(current.is_active);
    const nextDescription = Object.prototype.hasOwnProperty.call(req.body, "description")
      ? String(req.body?.description || "").trim() || null
      : current.description;

    if (!nextCode) {
      return res.status(400).json({ message: "code cannot be empty" });
    }
    if (nextDiscountType !== "PERCENT" && nextDiscountType !== "FIXED") {
      return res.status(400).json({ message: "discount_type must be PERCENT or FIXED" });
    }
    if (nextDiscountValue === null || nextDiscountValue <= 0) {
      return res.status(400).json({ message: "discount_value must be greater than 0" });
    }
    if (nextDiscountType === "PERCENT" && nextDiscountValue > 100) {
      return res.status(400).json({ message: "For PERCENT, discount_value cannot exceed 100" });
    }
    if (nextMinOrderAmount === null) {
      return res.status(400).json({ message: "Invalid min_order_amount" });
    }
    if (nextMaxDiscountAmount === undefined) {
      return res.status(400).json({ message: "Invalid max_discount_amount" });
    }
    if (nextUsageLimitTotal === undefined) {
      return res.status(400).json({ message: "Invalid usage_limit_total" });
    }
    if (nextUsageLimitPerUser === undefined) {
      return res.status(400).json({ message: "Invalid usage_limit_per_user" });
    }
    if (nextStartsAt === undefined) {
      return res.status(400).json({ message: "Invalid starts_at" });
    }
    if (nextExpiresAt === undefined) {
      return res.status(400).json({ message: "Invalid expires_at" });
    }
    if (nextIsActive === null) {
      return res.status(400).json({ message: "is_active must be true/false or 1/0" });
    }
    if (nextDiscountType === "FIXED" && nextMaxDiscountAmount !== null) {
      return res.status(400).json({ message: "max_discount_amount is only allowed for PERCENT coupons" });
    }
    if (
      nextStartsAt &&
      nextExpiresAt &&
      new Date(nextStartsAt).getTime() > new Date(nextExpiresAt).getTime()
    ) {
      return res.status(400).json({ message: "starts_at cannot be after expires_at" });
    }

    await db.query(
      `UPDATE coupons
       SET
         code = ?,
         description = ?,
         discount_type = ?,
         discount_value = ?,
         max_discount_amount = ?,
         min_order_amount = ?,
         starts_at = ?,
         expires_at = ?,
         usage_limit_total = ?,
         usage_limit_per_user = ?,
         is_active = ?
       WHERE coupon_id = ?`,
      [
        nextCode,
        nextDescription,
        nextDiscountType,
        nextDiscountValue,
        nextMaxDiscountAmount,
        nextMinOrderAmount,
        nextStartsAt,
        nextExpiresAt,
        nextUsageLimitTotal,
        nextUsageLimitPerUser,
        nextIsActive,
        couponId,
      ]
    );

    const [rows]: any = await db.query(
      `SELECT
        coupon_id, code, description, discount_type, discount_value, max_discount_amount,
        min_order_amount, starts_at, expires_at, usage_limit_total, usage_limit_per_user,
        used_count, is_active, created_at, updated_at
      FROM coupons
      WHERE coupon_id = ?
      LIMIT 1`,
      [couponId]
    );

    return res.json({ message: "Coupon updated", coupon: rows[0] });
  } catch (error: any) {
    console.error("UPDATE COUPON ERROR:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Coupon code already exists" });
    }
    return res.status(500).json({ message: "Unable to update coupon" });
  }
};

export const deleteCoupon = async (req: Request, res: Response) => {
  const couponId = parsePositiveInt(req.params.id);
  if (!couponId) {
    return res.status(400).json({ message: "Invalid coupon id" });
  }

  try {
    const [result]: any = await db.query(
      "DELETE FROM coupons WHERE coupon_id = ?",
      [couponId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Coupon not found" });
    }

    return res.json({ message: "Coupon deleted" });
  } catch (error: any) {
    console.error("DELETE COUPON ERROR:", error);
    if (error?.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(400).json({ message: "Coupon is already used in orders" });
    }
    return res.status(500).json({ message: "Unable to delete coupon" });
  }
};

const listDatabaseTables = async (): Promise<string[]> => {
  const [rows]: any = await db.query("SHOW TABLES");
  return rows
    .map((row: Record<string, unknown>) => String(Object.values(row)[0] || "").trim())
    .filter(Boolean)
    .sort((a: string, b: string) => a.localeCompare(b));
};

const isValidTableName = (value: string): boolean => /^[A-Za-z0-9_]+$/.test(value);

export const getDbTables = async (_req: Request, res: Response) => {
  try {
    const tables = await listDatabaseTables();
    return res.json({ tables });
  } catch (error) {
    console.error("GET DB TABLES ERROR:", error);
    return res.status(500).json({ message: "Unable to fetch database tables" });
  }
};

export const getDbTableRows = async (req: Request, res: Response) => {
  const tableName = String(req.params.tableName || "").trim();
  const rawLimit = Number(req.query.limit || 100);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;

  if (!tableName || !isValidTableName(tableName)) {
    return res.status(400).json({ message: "Invalid table name" });
  }

  try {
    const tables = await listDatabaseTables();
    if (!tables.includes(tableName)) {
      return res.status(404).json({ message: "Table not found" });
    }

    const [columnRows]: any = await db.query(`SHOW COLUMNS FROM \`${tableName}\``);
    const columns = columnRows.map((column: any) => String(column.Field));

    const [rows]: any = await db.query(`SELECT * FROM \`${tableName}\` LIMIT ?`, [limit]);

    return res.json({
      table: tableName,
      columns,
      rows
    });
  } catch (error) {
    console.error("GET DB TABLE ROWS ERROR:", error);
    return res.status(500).json({ message: "Unable to fetch table rows" });
  }
};

interface ApiCatalogItem {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  access: "public" | "auth" | "admin";
}

const API_CATALOG: ApiCatalogItem[] = [
  { method: "GET", path: "/healthz", access: "public" },

  { method: "POST", path: "/api/auth/login", access: "public" },
  { method: "POST", path: "/api/auth/register", access: "public" },
  { method: "POST", path: "/api/auth/google", access: "public" },

  { method: "GET", path: "/api/categories", access: "public" },
  { method: "GET", path: "/api/categories/:id", access: "public" },
  { method: "GET", path: "/api/categories/:id/products", access: "public" },
  { method: "GET", path: "/api/categories/with-products", access: "public" },

  { method: "GET", path: "/api/products", access: "public" },
  { method: "GET", path: "/api/products/category/:categoryId", access: "public" },
  { method: "GET", path: "/api/products/:id", access: "public" },

  { method: "POST", path: "/api/contact", access: "public" },

  { method: "GET", path: "/api/reviews/product/:productId", access: "public" },
  { method: "POST", path: "/api/reviews", access: "auth" },
  { method: "PUT", path: "/api/reviews/:reviewId", access: "auth" },
  { method: "DELETE", path: "/api/reviews/:reviewId", access: "auth" },

  { method: "GET", path: "/api/cart", access: "auth" },
  { method: "POST", path: "/api/cart", access: "auth" },
  { method: "PUT", path: "/api/cart/:id", access: "auth" },
  { method: "DELETE", path: "/api/cart/:id", access: "auth" },

  { method: "POST", path: "/api/checkout", access: "auth" },
  { method: "POST", path: "/api/orders", access: "auth" },
  { method: "GET", path: "/api/orders/my", access: "auth" },

  { method: "POST", path: "/api/payment/create-order", access: "auth" },
  { method: "POST", path: "/api/payment/verify", access: "auth" },
  { method: "POST", path: "/api/payment/webhook", access: "public" },

  { method: "GET", path: "/api/shipping", access: "auth" },
  { method: "POST", path: "/api/shipping", access: "auth" },
  { method: "PUT", path: "/api/shipping/:shipping_id", access: "auth" },
  { method: "DELETE", path: "/api/shipping/:shipping_id", access: "auth" },

  { method: "GET", path: "/api/admin/db/tables", access: "admin" },
  { method: "GET", path: "/api/admin/db/tables/:tableName", access: "admin" },

  { method: "POST", path: "/api/admin/categories", access: "admin" },
  { method: "PUT", path: "/api/admin/categories/:id", access: "admin" },
  { method: "DELETE", path: "/api/admin/categories/:id", access: "admin" },

  { method: "POST", path: "/api/admin/products", access: "admin" },
  { method: "PUT", path: "/api/admin/products/:id", access: "admin" },
  { method: "DELETE", path: "/api/admin/products/:id", access: "admin" },

  { method: "GET", path: "/api/admin/coupons", access: "admin" },
  { method: "GET", path: "/api/admin/coupons/:id", access: "admin" },
  { method: "POST", path: "/api/admin/coupons", access: "admin" },
  { method: "PUT", path: "/api/admin/coupons/:id", access: "admin" },
  { method: "DELETE", path: "/api/admin/coupons/:id", access: "admin" }
];

export const getApiCatalog = async (_req: Request, res: Response) => {
  return res.json({ apis: API_CATALOG });
};

export const uploadAdminImage = async (req: Request, res: Response) => {
  try {
    const file = (req as Request & { file?: Express.Multer.File }).file;

    if (!file) {
      return res.status(400).json({ message: "Image file is required" });
    }

    const filename = String(file.filename || "").trim();
    if (!filename) {
      return res.status(500).json({ message: "Uploaded file name is invalid" });
    }

    const localPath = String((file as Express.Multer.File & { path?: string }).path || "").trim();

    if (isR2Configured() && localPath) {
      const objectKey = `products/admin/${filename}`;
      const url = await uploadFileToR2(localPath, objectKey);
      await unlink(localPath).catch(() => undefined);

      return res.status(201).json({
        message: "Image uploaded",
        filename,
        path: url,
        url,
      });
    }

    const path = `/assets/images/${filename}`;
    return res.status(201).json({
      message: "Image uploaded",
      filename,
      path,
      url: path,
    });
  } catch (error) {
    console.error("UPLOAD IMAGE ERROR:", error);
    return res.status(500).json({ message: "Unable to upload image" });
  }
};
