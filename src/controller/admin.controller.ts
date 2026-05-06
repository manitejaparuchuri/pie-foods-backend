import { Request, Response } from "express";
import { unlink } from "fs/promises";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";

import { firestore } from "../config/firebase";
import { isR2Configured, uploadFileToR2 } from "../config/r2";
import { useFirebaseAuth } from "../config/auth-provider";
import firestoreCatalogService from "../services/catalog-firestore.service";
import { isAuthFlowError, loginFirebaseAdmin } from "../services/firebase-auth.service";
import { bumpCacheVersion } from "../config/cache";

const invalidateCatalog = () => bumpCacheVersion("catalog");

const ADMIN_ENV_UID = "admin:env";

const couponsCollection = firestore.collection("coupons");

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
  return parsed.toISOString();
};

const normalizeCouponCode = (value: unknown): string => {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
};

const FIRESTORE_PRODUCT_IMAGE_FIELDS = [
  "image_url",
  "image_url1",
  "image_url2",
  "image_url3",
  "image_url4",
  "image_url5",
] as const;

const toIsoString = (value: any): string => {
  if (!value) return new Date().toISOString();
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const getCategorySlug = (category: any): string | null => {
  return String(category?.slug || category?.category_slug || "").trim() || null;
};

const normalizeFirestoreCategoryForAdmin = (category: any, productCount = 0) => ({
  category_id: Number(category.category_id),
  name: String(category.name || ""),
  description: category.description ?? null,
  image_url: category.image_url ?? null,
  product_count: productCount,
});

const normalizeFirestoreProductForAdmin = (product: any) => ({
  ...product,
  product_id: Number(product.product_id),
  price: Number(product.price) || 0,
  stock_quantity: Number(product.stock_quantity) || 0,
  category_id: Number(product.category_id) || 0,
  is_active: product.is_active === false ? 0 : 1,
  created_at: toIsoString(product.created_at),
});

const normalizeFirestoreComboForAdmin = (combo: any) => ({
  combo_id: Number(combo.combo_id),
  name: String(combo.name || ""),
  slug: combo.slug ?? null,
  description: combo.description ?? null,
  badge: combo.badge ?? null,
  product_ids: Array.isArray(combo.product_ids)
    ? combo.product_ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
    : [],
  discount_percent: Number(combo.discount_percent) || 0,
  is_active: combo.is_active === false ? 0 : 1,
  sort_order: Number(combo.sort_order) || Number(combo.combo_id) || 0,
  created_at: toIsoString(combo.created_at),
  updated_at: toIsoString(combo.updated_at),
});

const normalizeFirestoreBannerForAdmin = (banner: any) => ({
  banner_id: Number(banner.banner_id),
  slug: banner.slug ?? null,
  image_url: banner.image_url ?? null,
  caption: String(banner.caption || ""),
  title_top: String(banner.title_top || ""),
  title_accent: String(banner.title_accent || ""),
  title_bottom: banner.title_bottom ?? null,
  description: banner.description ?? null,
  chips: Array.isArray(banner.chips) ? banner.chips : [],
  primary_cta: banner.primary_cta || { text: "Shop Now", link: "/products" },
  secondary_cta: banner.secondary_cta ?? null,
  align: banner.align === "right" ? "right" : "left",
  is_active: banner.is_active === false ? 0 : 1,
  sort_order: Number(banner.sort_order) || Number(banner.banner_id) || 0,
  created_at: toIsoString(banner.created_at),
  updated_at: toIsoString(banner.updated_at),
});

const normalizeFirestorePopularShowcaseForAdmin = (showcase: any) => ({
  section_id: String(showcase?.section_id || "main"),
  eyebrow: String(showcase?.eyebrow || "Curated Selection"),
  title: String(showcase?.title || "Popular Products"),
  is_active: showcase?.is_active === false ? 0 : 1,
  items: Array.isArray(showcase?.items)
    ? showcase.items.map((item: any, index: number) => ({
        item_id: Number(item.item_id) || index + 1,
        name: String(item.name || ""),
        tagline: item.tagline ?? null,
        caption: item.caption ?? null,
        button_text: item.button_text ?? null,
        link: item.link ?? null,
        image_url: item.image_url ?? null,
        is_featured: item.is_featured === true ? 1 : 0,
        is_active: item.is_active === false ? 0 : 1,
        sort_order: Number(item.sort_order) || index + 1,
      }))
    : [],
  created_at: toIsoString(showcase?.created_at),
  updated_at: toIsoString(showcase?.updated_at),
});

const parseProductIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const item of value) {
    const parsed = parsePositiveInt(item);
    if (parsed && !seen.has(parsed)) {
      seen.add(parsed);
      ids.push(parsed);
    }
  }
  return ids;
};

const ALLOWED_BANNER_CHIP_ICONS = new Set(["leaf", "zero", "gi", "fruit", "drop", "sparkle", "box"]);

const parseBannerChips = (value: unknown): Array<{ icon: string; label: string }> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((chip) => {
      if (!chip || typeof chip !== "object") return null;
      const rawChip = chip as Record<string, unknown>;
      const icon = String(rawChip.icon || "").trim();
      const label = String(rawChip.label || "").trim();
      if (!ALLOWED_BANNER_CHIP_ICONS.has(icon) || !label) return null;
      return { icon, label };
    })
    .filter((chip): chip is { icon: string; label: string } => Boolean(chip))
    .slice(0, 4);
};

const parseBannerCta = (value: unknown): { text: string; link: string } | null => {
  if (!value || typeof value !== "object") return null;
  const rawCta = value as Record<string, unknown>;
  const text = String(rawCta.text || "").trim();
  const link = String(rawCta.link || "").trim();
  if (!text || !link) return null;
  return { text, link };
};

const parsePopularShowcaseItems = (
  value: unknown
): Array<{
  item_id: number;
  name: string;
  tagline: string | null;
  caption: string | null;
  button_text: string | null;
  link: string | null;
  image_url: string;
  is_featured: number;
  is_active: number;
  sort_order: number;
}> | null => {
  if (!Array.isArray(value)) return null;

  const items: Array<{
    item_id: number;
    name: string;
    tagline: string | null;
    caption: string | null;
    button_text: string | null;
    link: string | null;
    image_url: string;
    is_featured: number;
    is_active: number;
    sort_order: number;
  }> = [];

  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const name = String(item.name || "").trim();
    const imageUrl = String(item.image_url || "").trim();
    const itemId = parsePositiveInt(item.item_id) || index + 1;
    const sortOrder =
      item.sort_order === undefined || item.sort_order === null || String(item.sort_order).trim() === ""
        ? (index + 1) * 10
        : parseNonNegativeInt(item.sort_order);
    const isFeatured = item.is_featured === undefined ? 0 : parseBooleanFlag(item.is_featured);
    const isActive = item.is_active === undefined ? 1 : parseBooleanFlag(item.is_active);

    if (!name || !imageUrl || sortOrder === null || isFeatured === null || isActive === null) {
      return null;
    }

    items.push({
      item_id: itemId,
      name,
      tagline: String(item.tagline || "").trim() || null,
      caption: String(item.caption || "").trim() || null,
      button_text: String(item.button_text || "").trim() || null,
      link: String(item.link || "").trim() || null,
      image_url: imageUrl,
      is_featured: isFeatured,
      is_active: isActive,
      sort_order: sortOrder,
    });
  }

  return items.slice(0, 8);
};

const isEqualSecret = (provided: string, expected: string): boolean => {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
};

/* ============================ ADMIN LOGIN ============================ */

export const adminLogin = async (req: Request, res: Response) => {
  const username = String(req.body?.username || req.body?.email || "").trim();
  const password = String(req.body?.password || "");
  const configuredUsername = String(process.env.ADMIN_ID || "").trim();
  const configuredPassword = String(process.env.ADMIN_PASSWORD || "").trim();

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }

  if (useFirebaseAuth()) {
    try {
      const admin = await loginFirebaseAdmin(username, password);
      const token = jwt.sign(
        {
          uid: admin.uid,
          role: "admin",
          email: admin.email,
        },
        process.env.JWT_SECRET as string,
        { expiresIn: "12h" }
      );

      return res.json({
        message: "Admin login successful",
        token,
        admin: { username: admin.email, role: "admin" },
      });
    } catch (error) {
      if (isAuthFlowError(error)) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("FIREBASE ADMIN LOGIN ERROR:", error);
      return res.status(500).json({ message: "Unable to sign in admin" });
    }
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
      uid: ADMIN_ENV_UID,
      role: "admin",
      email: configuredUsername,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "12h" }
  );

  return res.json({
    message: "Admin login successful",
    token,
    admin: { username: configuredUsername, role: "admin" },
  });
};

/* ============================ BOOTSTRAP ============================ */

export const getAdminBootstrap = async (_req: Request, res: Response) => {
  try {
    const [categories, products, combos, banners, popularShowcase, couponDocs] = await Promise.all([
      firestoreCatalogService.getAllCategories(),
      firestoreCatalogService.getAllProductsForAdmin(),
      firestoreCatalogService.getAllCombos(),
      firestoreCatalogService.getAllBanners(),
      firestoreCatalogService.getPopularProductShowcase(),
      couponsCollection.get(),
    ]);

    const productCounts = new Map<number, number>();
    for (const product of products) {
      const categoryId = Number(product.category_id || 0);
      productCounts.set(categoryId, (productCounts.get(categoryId) || 0) + 1);
    }

    const coupons = couponDocs.docs.map((doc) => normalizeFirestoreCouponForAdmin(doc.id, doc.data()));

    return res.json({
      categories: categories.map((category) =>
        normalizeFirestoreCategoryForAdmin(
          category,
          productCounts.get(Number(category.category_id)) || 0
        )
      ),
      products: products.map(normalizeFirestoreProductForAdmin),
      combos: combos.map(normalizeFirestoreComboForAdmin),
      banners: banners.map(normalizeFirestoreBannerForAdmin),
      popularShowcase: normalizeFirestorePopularShowcaseForAdmin(popularShowcase),
      coupons,
      productImageFields: [...FIRESTORE_PRODUCT_IMAGE_FIELDS],
      supportsProductActive: true,
    });
  } catch (error) {
    console.error("ADMIN BOOTSTRAP ERROR:", error);
    return res.status(500).json({ message: "Unable to load admin data" });
  }
};

/* ============================ CATEGORIES ============================ */

export const createCategory = async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim();
  const imageUrl = String(req.body?.image_url || "").trim();

  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  try {
    const nextId = await firestoreCatalogService.getNextCategoryId();
    const category = await firestoreCatalogService.upsertCategory({
      category_id: nextId,
      name,
      description: description || null,
      image_url: imageUrl || null,
    });
    invalidateCatalog();
    return res.status(201).json({ message: "Category created", category });
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

  try {
    const existing = await firestoreCatalogService.getCategoryById(categoryId);
    if (!existing) {
      return res.status(404).json({ message: "Category not found" });
    }

    const name = Object.prototype.hasOwnProperty.call(req.body, "name")
      ? String(req.body?.name || "").trim()
      : existing.name;
    if (Object.prototype.hasOwnProperty.call(req.body, "name") && !name) {
      return res.status(400).json({ message: "name cannot be empty" });
    }

    const description = Object.prototype.hasOwnProperty.call(req.body, "description")
      ? String(req.body?.description || "").trim() || null
      : existing.description;

    const image_url = Object.prototype.hasOwnProperty.call(req.body, "image_url")
      ? String(req.body?.image_url || "").trim() || null
      : existing.image_url;

    const category = await firestoreCatalogService.upsertCategory({
      category_id: categoryId,
      name,
      description,
      image_url,
    });
    invalidateCatalog();
    return res.json({ message: "Category updated", category });
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
    const products = await firestoreCatalogService.getProductsByCategory(categoryId);
    if (products.length > 0) {
      return res.status(400).json({
        message: "Cannot delete category with existing products",
        productCount: products.length,
      });
    }

    await firestoreCatalogService.deleteCategory(categoryId);
    invalidateCatalog();
    return res.json({ message: "Category deleted" });
  } catch (error) {
    console.error("DELETE CATEGORY ERROR:", error);
    return res.status(500).json({ message: "Unable to delete category" });
  }
};

/* ============================ PRODUCTS ============================ */

const buildProductPayload = (
  body: Record<string, unknown>,
  productId: number,
  existing?: Record<string, unknown> | null
) => {
  const get = (key: string, fallback: unknown = null) =>
    Object.prototype.hasOwnProperty.call(body, key) ? body[key] : (existing?.[key] ?? fallback);

  const isActiveRaw = Object.prototype.hasOwnProperty.call(body, "is_active")
    ? parseBooleanFlag(body.is_active)
    : existing?.is_active === false || existing?.is_active === 0
    ? 0
    : 1;

  const payload: Record<string, unknown> = {
    product_id: productId,
    name: String(get("name", "") || "").trim(),
    sub_name: get("sub_name") ? String(get("sub_name")).trim() : null,
    description: get("description") ? String(get("description")).trim() : null,
    details: get("details") ? String(get("details")).trim() : null,
    specifications: get("specifications") ? String(get("specifications")).trim() : null,
    counter_details: get("counter_details") ? String(get("counter_details")).trim() : null,
    warranty_installation: get("warranty_installation")
      ? String(get("warranty_installation")).trim()
      : null,
    price: Number(get("price", 0)) || 0,
    stock_quantity: Number(get("stock_quantity", 0)) || 0,
    category_id: Number(get("category_id", 0)) || 0,
    is_active: isActiveRaw === 0 ? false : true,
  };

  for (let i = 0; i <= 10; i += 1) {
    const key = i === 0 ? "image_url" : `image_url${i}`;
    if (
      Object.prototype.hasOwnProperty.call(body, key) ||
      (existing && Object.prototype.hasOwnProperty.call(existing, key))
    ) {
      const value = get(key);
      payload[key] = value ? String(value).trim() || null : null;
    }
  }

  return payload as any;
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
    const category = await firestoreCatalogService.getCategoryById(categoryId);
    if (!category) {
      return res.status(400).json({ message: "Invalid category_id" });
    }

    const nextId = await firestoreCatalogService.getNextProductId();
    const payload = buildProductPayload(req.body, nextId);
    payload.category_name = category.name ?? null;
    payload.category_slug = getCategorySlug(category);

    const product = await firestoreCatalogService.upsertProduct(payload);
    invalidateCatalog();
    return res.status(201).json({
      message: "Product created",
      product: normalizeFirestoreProductForAdmin(product),
    });
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

  try {
    const existing = await firestoreCatalogService.getProductById(productId);
    if (!existing) {
      return res.status(404).json({ message: "Product not found" });
    }

    let categoryId = Number(existing.category_id) || 0;
    if (Object.prototype.hasOwnProperty.call(req.body, "category_id")) {
      const next = parsePositiveInt(req.body.category_id);
      if (!next) {
        return res.status(400).json({ message: "Invalid category_id" });
      }
      categoryId = next;
    }

    const category = await firestoreCatalogService.getCategoryById(categoryId);
    if (!category) {
      return res.status(400).json({ message: "Invalid category_id" });
    }

    const payload = buildProductPayload(req.body, productId, existing as any);
    payload.category_id = categoryId;
    payload.category_name = category.name ?? null;
    payload.category_slug = getCategorySlug(category);

    const product = await firestoreCatalogService.upsertProduct(payload);
    invalidateCatalog();
    return res.json({
      message: "Product updated",
      product: normalizeFirestoreProductForAdmin(product),
    });
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
    const existing = await firestoreCatalogService.getProductById(productId);
    if (!existing) {
      return res.status(404).json({ message: "Product not found" });
    }

    await firestoreCatalogService.deleteProduct(productId);
    invalidateCatalog();
    return res.json({ message: "Product deleted" });
  } catch (error) {
    console.error("DELETE PRODUCT ERROR:", error);
    return res.status(500).json({ message: "Unable to delete product" });
  }
};

/* ============================ COMBOS ============================ */

export const createCombo = async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const productIds = parseProductIds(req.body?.product_ids);
  const discountPercent = parseNonNegativeNumber(req.body?.discount_percent ?? 10);
  const sortOrder =
    req.body?.sort_order === undefined ||
    req.body?.sort_order === null ||
    String(req.body?.sort_order).trim() === ""
      ? null
      : parseNonNegativeInt(req.body?.sort_order);
  const isActive = req.body?.is_active === undefined ? 1 : parseBooleanFlag(req.body?.is_active);

  if (!name) return res.status(400).json({ message: "name is required" });
  if (productIds.length < 2)
    return res.status(400).json({ message: "Select at least 2 products for a combo" });
  if (discountPercent === null || discountPercent > 90)
    return res.status(400).json({ message: "discount_percent must be between 0 and 90" });
  if (sortOrder === undefined) return res.status(400).json({ message: "Invalid sort_order" });
  if (isActive === null) return res.status(400).json({ message: "Invalid is_active value" });

  try {
    const combo = await firestoreCatalogService.upsertCombo({
      name,
      description: String(req.body?.description || "").trim() || null,
      badge: String(req.body?.badge || "").trim() || null,
      product_ids: productIds,
      discount_percent: discountPercent,
      is_active: isActive,
      sort_order: sortOrder,
    });

    invalidateCatalog();
    return res.status(201).json({
      message: "Combo created",
      combo: normalizeFirestoreComboForAdmin(combo),
    });
  } catch (error) {
    console.error("CREATE COMBO ERROR:", error);
    return res.status(500).json({ message: "Unable to create combo" });
  }
};

export const updateCombo = async (req: Request, res: Response) => {
  const comboId = parsePositiveInt(req.params.id);
  if (!comboId) return res.status(400).json({ message: "Invalid combo id" });

  const name = String(req.body?.name || "").trim();
  const productIds = parseProductIds(req.body?.product_ids);
  const discountPercent = parseNonNegativeNumber(req.body?.discount_percent ?? 10);
  const sortOrder =
    req.body?.sort_order === undefined ||
    req.body?.sort_order === null ||
    String(req.body?.sort_order).trim() === ""
      ? comboId
      : parseNonNegativeInt(req.body?.sort_order);
  const isActive = req.body?.is_active === undefined ? 1 : parseBooleanFlag(req.body?.is_active);

  if (!name) return res.status(400).json({ message: "name is required" });
  if (productIds.length < 2)
    return res.status(400).json({ message: "Select at least 2 products for a combo" });
  if (discountPercent === null || discountPercent > 90)
    return res.status(400).json({ message: "discount_percent must be between 0 and 90" });
  if (sortOrder === null) return res.status(400).json({ message: "Invalid sort_order" });
  if (isActive === null) return res.status(400).json({ message: "Invalid is_active value" });

  try {
    const combo = await firestoreCatalogService.upsertCombo({
      combo_id: comboId,
      name,
      description: String(req.body?.description || "").trim() || null,
      badge: String(req.body?.badge || "").trim() || null,
      product_ids: productIds,
      discount_percent: discountPercent,
      is_active: isActive,
      sort_order: sortOrder,
    });

    invalidateCatalog();
    return res.json({
      message: "Combo updated",
      combo: normalizeFirestoreComboForAdmin(combo),
    });
  } catch (error) {
    console.error("UPDATE COMBO ERROR:", error);
    return res.status(500).json({ message: "Unable to update combo" });
  }
};

export const deleteCombo = async (req: Request, res: Response) => {
  const comboId = parsePositiveInt(req.params.id);
  if (!comboId) return res.status(400).json({ message: "Invalid combo id" });

  try {
    await firestoreCatalogService.deleteCombo(comboId);
    invalidateCatalog();
    return res.json({ message: "Combo deleted" });
  } catch (error) {
    console.error("DELETE COMBO ERROR:", error);
    return res.status(500).json({ message: "Unable to delete combo" });
  }
};

/* ============================ BANNERS ============================ */

export const createBanner = async (req: Request, res: Response) => {
  const imageUrl = String(req.body?.image_url || "").trim();
  const caption = String(req.body?.caption || "").trim();
  const titleTop = String(req.body?.title_top || "").trim();
  const titleAccent = String(req.body?.title_accent || "").trim();
  const primaryCta = parseBannerCta(req.body?.primary_cta);
  const secondaryCta = parseBannerCta(req.body?.secondary_cta);
  const chips = parseBannerChips(req.body?.chips);
  const sortOrder =
    req.body?.sort_order === undefined ||
    req.body?.sort_order === null ||
    String(req.body?.sort_order).trim() === ""
      ? undefined
      : parseNonNegativeInt(req.body?.sort_order);
  const isActive = req.body?.is_active === undefined ? 1 : parseBooleanFlag(req.body?.is_active);

  if (!imageUrl) return res.status(400).json({ message: "image_url is required" });
  if (!caption || !titleTop || !titleAccent)
    return res.status(400).json({ message: "caption, title_top and title_accent are required" });
  if (!primaryCta)
    return res.status(400).json({ message: "Primary button text and link are required" });
  if (sortOrder === null) return res.status(400).json({ message: "Invalid sort_order" });
  if (isActive === null) return res.status(400).json({ message: "Invalid is_active value" });

  try {
    const banner = await firestoreCatalogService.upsertBanner({
      image_url: imageUrl,
      caption,
      title_top: titleTop,
      title_accent: titleAccent,
      title_bottom: String(req.body?.title_bottom || "").trim() || null,
      description: String(req.body?.description || "").trim() || null,
      chips,
      primary_cta: primaryCta,
      secondary_cta: secondaryCta,
      align: String(req.body?.align || "left").trim() === "right" ? "right" : "left",
      is_active: isActive,
      sort_order: sortOrder,
    });

    invalidateCatalog();
    return res.status(201).json({
      message: "Banner created",
      banner: normalizeFirestoreBannerForAdmin(banner),
    });
  } catch (error) {
    console.error("CREATE BANNER ERROR:", error);
    return res.status(500).json({ message: "Unable to create banner" });
  }
};

export const updateBanner = async (req: Request, res: Response) => {
  const bannerId = parsePositiveInt(req.params.id);
  if (!bannerId) return res.status(400).json({ message: "Invalid banner id" });

  const imageUrl = String(req.body?.image_url || "").trim();
  const caption = String(req.body?.caption || "").trim();
  const titleTop = String(req.body?.title_top || "").trim();
  const titleAccent = String(req.body?.title_accent || "").trim();
  const primaryCta = parseBannerCta(req.body?.primary_cta);
  const secondaryCta = parseBannerCta(req.body?.secondary_cta);
  const chips = parseBannerChips(req.body?.chips);
  const sortOrder =
    req.body?.sort_order === undefined ||
    req.body?.sort_order === null ||
    String(req.body?.sort_order).trim() === ""
      ? bannerId
      : parseNonNegativeInt(req.body?.sort_order);
  const isActive = req.body?.is_active === undefined ? 1 : parseBooleanFlag(req.body?.is_active);

  if (!imageUrl) return res.status(400).json({ message: "image_url is required" });
  if (!caption || !titleTop || !titleAccent)
    return res.status(400).json({ message: "caption, title_top and title_accent are required" });
  if (!primaryCta)
    return res.status(400).json({ message: "Primary button text and link are required" });
  if (sortOrder === null) return res.status(400).json({ message: "Invalid sort_order" });
  if (isActive === null) return res.status(400).json({ message: "Invalid is_active value" });

  try {
    const banner = await firestoreCatalogService.upsertBanner({
      banner_id: bannerId,
      image_url: imageUrl,
      caption,
      title_top: titleTop,
      title_accent: titleAccent,
      title_bottom: String(req.body?.title_bottom || "").trim() || null,
      description: String(req.body?.description || "").trim() || null,
      chips,
      primary_cta: primaryCta,
      secondary_cta: secondaryCta,
      align: String(req.body?.align || "left").trim() === "right" ? "right" : "left",
      is_active: isActive,
      sort_order: sortOrder,
    });

    invalidateCatalog();
    return res.json({
      message: "Banner updated",
      banner: normalizeFirestoreBannerForAdmin(banner),
    });
  } catch (error) {
    console.error("UPDATE BANNER ERROR:", error);
    return res.status(500).json({ message: "Unable to update banner" });
  }
};

export const deleteBanner = async (req: Request, res: Response) => {
  const bannerId = parsePositiveInt(req.params.id);
  if (!bannerId) return res.status(400).json({ message: "Invalid banner id" });

  try {
    await firestoreCatalogService.deleteBanner(bannerId);
    invalidateCatalog();
    return res.json({ message: "Banner deleted" });
  } catch (error) {
    console.error("DELETE BANNER ERROR:", error);
    return res.status(500).json({ message: "Unable to delete banner" });
  }
};

export const updatePopularProductsShowcase = async (req: Request, res: Response) => {
  const eyebrow = String(req.body?.eyebrow || "").trim();
  const title = String(req.body?.title || "").trim();
  const items = parsePopularShowcaseItems(req.body?.items);
  const isActive = req.body?.is_active === undefined ? 1 : parseBooleanFlag(req.body?.is_active);

  if (!eyebrow || !title)
    return res.status(400).json({ message: "eyebrow and title are required" });
  if (!items || !items.length)
    return res.status(400).json({ message: "Add at least one popular product with name and image" });
  if (isActive === null) return res.status(400).json({ message: "Invalid is_active value" });

  try {
    const showcase = await firestoreCatalogService.upsertPopularProductShowcase({
      eyebrow,
      title,
      is_active: isActive,
      items,
    });

    invalidateCatalog();
    return res.json({
      message: "Popular products updated",
      popularShowcase: normalizeFirestorePopularShowcaseForAdmin(showcase),
    });
  } catch (error) {
    console.error("UPDATE POPULAR PRODUCTS ERROR:", error);
    return res.status(500).json({ message: "Unable to update popular products" });
  }
};

/* ============================ COUPONS ============================ */

const normalizeFirestoreCouponForAdmin = (
  docId: string,
  data: Record<string, unknown>
) => ({
  coupon_id: docId,
  code: String(data.code || docId),
  description: data.description ?? null,
  discount_type: String(data.discount_type || "PERCENT"),
  discount_value: Number(data.discount_value) || 0,
  max_discount_amount:
    data.max_discount_amount === null || data.max_discount_amount === undefined
      ? null
      : Number(data.max_discount_amount),
  min_order_amount: Number(data.min_order_amount) || 0,
  starts_at: data.starts_at ? toIsoString(data.starts_at) : null,
  expires_at: data.expires_at ? toIsoString(data.expires_at) : null,
  usage_limit_total:
    data.usage_limit_total === null || data.usage_limit_total === undefined
      ? null
      : Number(data.usage_limit_total),
  usage_limit_per_user:
    data.usage_limit_per_user === null || data.usage_limit_per_user === undefined
      ? null
      : Number(data.usage_limit_per_user),
  used_count: Number(data.used_count) || 0,
  is_active: data.is_active === false ? 0 : 1,
  created_at: data.created_at ? toIsoString(data.created_at) : null,
  updated_at: data.updated_at ? toIsoString(data.updated_at) : null,
});

const dateOrNullToTimestamp = (value: string | null | undefined): Timestamp | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
};

export const getCoupons = async (_req: Request, res: Response) => {
  try {
    const snap = await couponsCollection.get();
    const rows = snap.docs.map((doc) => normalizeFirestoreCouponForAdmin(doc.id, doc.data()));
    rows.sort((a, b) => a.code.localeCompare(b.code));
    return res.json(rows);
  } catch (error) {
    console.error("GET COUPONS ERROR:", error);
    return res.status(500).json({ message: "Unable to fetch coupons" });
  }
};

export const getCouponById = async (req: Request, res: Response) => {
  const couponId = String(req.params.id || "").trim().toUpperCase();
  if (!couponId) {
    return res.status(400).json({ message: "Invalid coupon id" });
  }

  try {
    const snap = await couponsCollection.doc(couponId).get();
    if (!snap.exists) {
      return res.status(404).json({ message: "Coupon not found" });
    }
    return res.json(normalizeFirestoreCouponForAdmin(snap.id, snap.data() as Record<string, unknown>));
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
  const isActive = req.body?.is_active === undefined ? 1 : parseBooleanFlag(req.body?.is_active);

  if (!code) return res.status(400).json({ message: "code is required" });
  if (discountType !== "PERCENT" && discountType !== "FIXED")
    return res.status(400).json({ message: "discount_type must be PERCENT or FIXED" });
  if (discountValue === null || discountValue <= 0)
    return res.status(400).json({ message: "discount_value must be greater than 0" });
  if (discountType === "PERCENT" && discountValue > 100)
    return res.status(400).json({ message: "For PERCENT, discount_value cannot exceed 100" });
  if (minOrderAmount === null) return res.status(400).json({ message: "Invalid min_order_amount" });
  if (maxDiscountAmount === undefined)
    return res.status(400).json({ message: "Invalid max_discount_amount" });
  if (usageLimitTotal === undefined)
    return res.status(400).json({ message: "Invalid usage_limit_total" });
  if (usageLimitPerUser === undefined)
    return res.status(400).json({ message: "Invalid usage_limit_per_user" });
  if (startsAt === undefined) return res.status(400).json({ message: "Invalid starts_at" });
  if (expiresAt === undefined) return res.status(400).json({ message: "Invalid expires_at" });
  if (isActive === null)
    return res.status(400).json({ message: "is_active must be true/false or 1/0" });
  if (discountType === "FIXED" && maxDiscountAmount !== null)
    return res
      .status(400)
      .json({ message: "max_discount_amount is only allowed for PERCENT coupons" });
  if (startsAt && expiresAt && new Date(startsAt).getTime() > new Date(expiresAt).getTime())
    return res.status(400).json({ message: "starts_at cannot be after expires_at" });

  try {
    const ref = couponsCollection.doc(code);
    const existing = await ref.get();
    if (existing.exists) {
      return res.status(409).json({ message: "Coupon code already exists" });
    }

    const now = Timestamp.now();
    await ref.set({
      code,
      description: description || null,
      discount_type: discountType,
      discount_value: discountValue,
      max_discount_amount: maxDiscountAmount,
      min_order_amount: minOrderAmount,
      starts_at: dateOrNullToTimestamp(startsAt),
      expires_at: dateOrNullToTimestamp(expiresAt),
      usage_limit_total: usageLimitTotal,
      usage_limit_per_user: usageLimitPerUser,
      used_count: 0,
      is_active: isActive === 1,
      created_at: now,
      updated_at: now,
    });

    const snap = await ref.get();
    return res
      .status(201)
      .json({ message: "Coupon created", coupon: normalizeFirestoreCouponForAdmin(snap.id, snap.data() as any) });
  } catch (error: any) {
    console.error("CREATE COUPON ERROR:", error);
    return res.status(500).json({ message: "Unable to create coupon" });
  }
};

export const updateCoupon = async (req: Request, res: Response) => {
  const couponId = String(req.params.id || "").trim().toUpperCase();
  if (!couponId) {
    return res.status(400).json({ message: "Invalid coupon id" });
  }

  try {
    const ref = couponsCollection.doc(couponId);
    const existingSnap = await ref.get();
    if (!existingSnap.exists) {
      return res.status(404).json({ message: "Coupon not found" });
    }
    const current = existingSnap.data() as Record<string, unknown>;

    const nextCode = Object.prototype.hasOwnProperty.call(req.body, "code")
      ? normalizeCouponCode(req.body.code)
      : String(current.code || couponId);
    const nextDiscountType = Object.prototype.hasOwnProperty.call(req.body, "discount_type")
      ? String(req.body.discount_type || "").trim().toUpperCase()
      : String(current.discount_type || "PERCENT").toUpperCase();
    const nextDiscountValue = Object.prototype.hasOwnProperty.call(req.body, "discount_value")
      ? parseNonNegativeNumber(req.body.discount_value)
      : Number(current.discount_value);
    const nextMaxDiscountAmount = Object.prototype.hasOwnProperty.call(req.body, "max_discount_amount")
      ? req.body.max_discount_amount === null || String(req.body.max_discount_amount).trim() === ""
        ? null
        : parseNonNegativeNumber(req.body.max_discount_amount)
      : current.max_discount_amount === null || current.max_discount_amount === undefined
      ? null
      : Number(current.max_discount_amount);
    const nextMinOrderAmount = Object.prototype.hasOwnProperty.call(req.body, "min_order_amount")
      ? parseNonNegativeNumber(req.body.min_order_amount)
      : Number(current.min_order_amount) || 0;
    const nextUsageLimitTotal = Object.prototype.hasOwnProperty.call(req.body, "usage_limit_total")
      ? req.body.usage_limit_total === null || String(req.body.usage_limit_total).trim() === ""
        ? null
        : parsePositiveInt(req.body.usage_limit_total)
      : (current.usage_limit_total as number | null);
    const nextUsageLimitPerUser = Object.prototype.hasOwnProperty.call(req.body, "usage_limit_per_user")
      ? req.body.usage_limit_per_user === null || String(req.body.usage_limit_per_user).trim() === ""
        ? null
        : parsePositiveInt(req.body.usage_limit_per_user)
      : (current.usage_limit_per_user as number | null);
    const nextStartsAt = Object.prototype.hasOwnProperty.call(req.body, "starts_at")
      ? parseOptionalDate(req.body.starts_at)
      : current.starts_at
      ? toIsoString(current.starts_at)
      : null;
    const nextExpiresAt = Object.prototype.hasOwnProperty.call(req.body, "expires_at")
      ? parseOptionalDate(req.body.expires_at)
      : current.expires_at
      ? toIsoString(current.expires_at)
      : null;
    const nextIsActive = Object.prototype.hasOwnProperty.call(req.body, "is_active")
      ? parseBooleanFlag(req.body.is_active)
      : current.is_active === false
      ? 0
      : 1;
    const nextDescription = Object.prototype.hasOwnProperty.call(req.body, "description")
      ? String(req.body.description || "").trim() || null
      : (current.description as string) || null;

    if (!nextCode) return res.status(400).json({ message: "code cannot be empty" });
    if (nextDiscountType !== "PERCENT" && nextDiscountType !== "FIXED")
      return res.status(400).json({ message: "discount_type must be PERCENT or FIXED" });
    if (nextDiscountValue === null || nextDiscountValue <= 0)
      return res.status(400).json({ message: "discount_value must be greater than 0" });
    if (nextDiscountType === "PERCENT" && nextDiscountValue > 100)
      return res.status(400).json({ message: "For PERCENT, discount_value cannot exceed 100" });
    if (nextMinOrderAmount === null)
      return res.status(400).json({ message: "Invalid min_order_amount" });
    if (nextMaxDiscountAmount === undefined)
      return res.status(400).json({ message: "Invalid max_discount_amount" });
    if (nextUsageLimitTotal === undefined)
      return res.status(400).json({ message: "Invalid usage_limit_total" });
    if (nextUsageLimitPerUser === undefined)
      return res.status(400).json({ message: "Invalid usage_limit_per_user" });
    if (nextStartsAt === undefined)
      return res.status(400).json({ message: "Invalid starts_at" });
    if (nextExpiresAt === undefined)
      return res.status(400).json({ message: "Invalid expires_at" });
    if (nextIsActive === null)
      return res.status(400).json({ message: "is_active must be true/false or 1/0" });
    if (nextDiscountType === "FIXED" && nextMaxDiscountAmount !== null)
      return res
        .status(400)
        .json({ message: "max_discount_amount is only allowed for PERCENT coupons" });
    if (
      nextStartsAt &&
      nextExpiresAt &&
      new Date(nextStartsAt).getTime() > new Date(nextExpiresAt).getTime()
    )
      return res.status(400).json({ message: "starts_at cannot be after expires_at" });

    if (nextCode !== couponId) {
      const newRef = couponsCollection.doc(nextCode);
      const conflict = await newRef.get();
      if (conflict.exists) {
        return res.status(409).json({ message: "Coupon code already exists" });
      }
      await newRef.set({
        ...current,
        code: nextCode,
        description: nextDescription,
        discount_type: nextDiscountType,
        discount_value: nextDiscountValue,
        max_discount_amount: nextMaxDiscountAmount,
        min_order_amount: nextMinOrderAmount,
        starts_at: dateOrNullToTimestamp(nextStartsAt),
        expires_at: dateOrNullToTimestamp(nextExpiresAt),
        usage_limit_total: nextUsageLimitTotal,
        usage_limit_per_user: nextUsageLimitPerUser,
        is_active: nextIsActive === 1,
        updated_at: Timestamp.now(),
      });
      await ref.delete();
      const finalSnap = await newRef.get();
      return res.json({
        message: "Coupon updated",
        coupon: normalizeFirestoreCouponForAdmin(finalSnap.id, finalSnap.data() as any),
      });
    }

    await ref.update({
      code: nextCode,
      description: nextDescription,
      discount_type: nextDiscountType,
      discount_value: nextDiscountValue,
      max_discount_amount: nextMaxDiscountAmount,
      min_order_amount: nextMinOrderAmount,
      starts_at: dateOrNullToTimestamp(nextStartsAt),
      expires_at: dateOrNullToTimestamp(nextExpiresAt),
      usage_limit_total: nextUsageLimitTotal,
      usage_limit_per_user: nextUsageLimitPerUser,
      is_active: nextIsActive === 1,
      updated_at: Timestamp.now(),
    });

    const finalSnap = await ref.get();
    return res.json({
      message: "Coupon updated",
      coupon: normalizeFirestoreCouponForAdmin(finalSnap.id, finalSnap.data() as any),
    });
  } catch (error: any) {
    console.error("UPDATE COUPON ERROR:", error);
    return res.status(500).json({ message: "Unable to update coupon" });
  }
};

export const deleteCoupon = async (req: Request, res: Response) => {
  const couponId = String(req.params.id || "").trim().toUpperCase();
  if (!couponId) return res.status(400).json({ message: "Invalid coupon id" });

  try {
    const ref = couponsCollection.doc(couponId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ message: "Coupon not found" });

    // Block deletion if usages exist (foreign-key analogue).
    const usages = await ref.collection("usages").limit(1).get();
    if (!usages.empty) {
      return res.status(400).json({ message: "Coupon is already used in orders" });
    }

    await ref.delete();
    return res.json({ message: "Coupon deleted" });
  } catch (error: any) {
    console.error("DELETE COUPON ERROR:", error);
    return res.status(500).json({ message: "Unable to delete coupon" });
  }
};

/* ============================ FIRESTORE BROWSER ============================ */

export const getDbTables = async (_req: Request, res: Response) => {
  try {
    const collections = await firestore.listCollections();
    const tables = collections.map((col) => col.id).sort((a, b) => a.localeCompare(b));
    return res.json({ tables });
  } catch (error) {
    console.error("GET DB TABLES ERROR:", error);
    return res.status(500).json({ message: "Unable to fetch collections" });
  }
};

export const getDbTableRows = async (req: Request, res: Response) => {
  const tableName = String(req.params.tableName || "").trim();
  const rawLimit = Number(req.query.limit || 100);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;

  if (!tableName || !/^[A-Za-z0-9_]+$/.test(tableName)) {
    return res.status(400).json({ message: "Invalid collection name" });
  }

  try {
    const snap = await firestore.collection(tableName).limit(limit).get();
    const rows = snap.docs.map((doc) => ({ _id: doc.id, ...doc.data() }));
    const columnSet = new Set<string>(["_id"]);
    rows.forEach((row) => Object.keys(row).forEach((k) => columnSet.add(k)));
    return res.json({
      table: tableName,
      columns: Array.from(columnSet),
      rows,
    });
  } catch (error) {
    console.error("GET DB TABLE ROWS ERROR:", error);
    return res.status(500).json({ message: "Unable to fetch collection rows" });
  }
};

/* ============================ API CATALOG ============================ */

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

  { method: "GET", path: "/api/combos", access: "public" },
  { method: "GET", path: "/api/banners", access: "public" },
  { method: "GET", path: "/api/popular-products", access: "public" },

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

  { method: "GET", path: "/api/admin/db/tables", access: "admin" },
  { method: "GET", path: "/api/admin/db/tables/:tableName", access: "admin" },

  { method: "POST", path: "/api/admin/categories", access: "admin" },
  { method: "PUT", path: "/api/admin/categories/:id", access: "admin" },
  { method: "DELETE", path: "/api/admin/categories/:id", access: "admin" },

  { method: "POST", path: "/api/admin/products", access: "admin" },
  { method: "PUT", path: "/api/admin/products/:id", access: "admin" },
  { method: "DELETE", path: "/api/admin/products/:id", access: "admin" },

  { method: "POST", path: "/api/admin/combos", access: "admin" },
  { method: "PUT", path: "/api/admin/combos/:id", access: "admin" },
  { method: "DELETE", path: "/api/admin/combos/:id", access: "admin" },

  { method: "POST", path: "/api/admin/banners", access: "admin" },
  { method: "PUT", path: "/api/admin/banners/:id", access: "admin" },
  { method: "DELETE", path: "/api/admin/banners/:id", access: "admin" },

  { method: "PUT", path: "/api/admin/popular-products", access: "admin" },

  { method: "GET", path: "/api/admin/coupons", access: "admin" },
  { method: "GET", path: "/api/admin/coupons/:id", access: "admin" },
  { method: "POST", path: "/api/admin/coupons", access: "admin" },
  { method: "PUT", path: "/api/admin/coupons/:id", access: "admin" },
  { method: "DELETE", path: "/api/admin/coupons/:id", access: "admin" },
];

export const getApiCatalog = async (_req: Request, res: Response) => {
  return res.json({ apis: API_CATALOG });
};

/* ============================ IMAGE UPLOAD ============================ */

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
