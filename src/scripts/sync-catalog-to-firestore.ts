import pool from "../config/db";
import {
  getFirestoreCategoriesCollectionName,
  getFirestoreProductsCollectionName,
} from "../config/catalog";
import { firestore } from "../config/firebase";
import { Timestamp } from "firebase-admin/firestore";

type MySqlCategoryRow = {
  category_id: number | string;
  name: string;
  description: string | null;
  image_url: string | null;
};

type MySqlProductRow = {
  product_id: number | string;
  name: string;
  sub_name: string | null;
  description: string | null;
  details: string | null;
  specifications: string | null;
  price: number | string | null;
  stock_quantity: number | string | null;
  image_url: string | null;
  image_url1: string | null;
  image_url2: string | null;
  image_url3?: string | null;
  category_id: number | string | null;
  category_name: string | null;
  created_at: Date | string | null;
};

type ExtraCategorySeed = {
  category_id: number;
  slug: string;
  name: string;
  description: string;
  image_url: string | null;
  sort_order: number;
};

const CATEGORY_SLUGS: Record<string, string> = {
  "Fruit Chips": "freeze-dried-fruits",
  "Natural Sweeteners": "monk-fruit-sweetener",
  "Monk Fruit Drops": "monk-fruit-drops",
};

const EXTRA_CATEGORIES: ExtraCategorySeed[] = [
  {
    category_id: 12,
    slug: "monk-fruit-drops",
    name: "Monk Fruit Drops",
    description:
      "Portable liquid monk fruit sweetness for coffee, tea, cold beverages, and daily use.",
    image_url: null,
    sort_order: 3,
  },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toTimestamp(value: unknown): Timestamp {
  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return Timestamp.fromDate(parsed);
    }
  }

  return Timestamp.now();
}

function getCategorySlug(categoryName: string): string {
  return CATEGORY_SLUGS[categoryName] || slugify(categoryName);
}

async function main(): Promise<void> {
  const categoriesCollection = firestore.collection(getFirestoreCategoriesCollectionName());
  const productsCollection = firestore.collection(getFirestoreProductsCollectionName());

  const [categoryRows] = await pool.query(
    `SELECT category_id, name, description, image_url
     FROM categories
     ORDER BY category_id ASC`
  ) as [MySqlCategoryRow[], unknown];

  const [productRows] = await pool.query(
    `SELECT
      p.product_id,
      p.name,
      p.sub_name,
      p.description,
      p.details,
      p.specifications,
      p.price,
      p.stock_quantity,
      p.image_url,
      p.image_url1,
      p.image_url2,
      p.category_id,
      c.name AS category_name,
      p.created_at
     FROM products p
     LEFT JOIN categories c ON c.category_id = p.category_id
     ORDER BY p.product_id ASC`
  ) as [MySqlProductRow[], unknown];

  const categoryBatch = firestore.batch();
  const mergedCategories = new Map<number, ExtraCategorySeed | (MySqlCategoryRow & { slug: string; sort_order: number })>();

  for (const row of categoryRows) {
    const categoryId = normalizeNumber(row.category_id);
    const name = String(row.name || "").trim();
    mergedCategories.set(categoryId, {
      ...row,
      category_id: categoryId,
      slug: getCategorySlug(name),
      sort_order: categoryId,
    });
  }

  for (const extraCategory of EXTRA_CATEGORIES) {
    if (!mergedCategories.has(extraCategory.category_id)) {
      mergedCategories.set(extraCategory.category_id, extraCategory);
    }
  }

  for (const category of Array.from(mergedCategories.values()).sort(
    (left, right) => normalizeNumber(left.category_id) - normalizeNumber(right.category_id)
  )) {
    const categoryId = normalizeNumber(category.category_id);
    const name = String(category.name || "").trim();
    const slug = "slug" in category && category.slug ? category.slug : getCategorySlug(name);
    const imageUrl =
      normalizeNullableString("image_url" in category ? category.image_url : null) ||
      normalizeNullableString(categoryRows.find((row) => String(row.name).trim() === "Natural Sweeteners")?.image_url);

    categoryBatch.set(
      categoriesCollection.doc(`category-${categoryId}`),
      {
        category_id: categoryId,
        slug,
        name,
        description: normalizeNullableString(category.description),
        image_url: imageUrl,
        sort_order: normalizeNumber("sort_order" in category ? category.sort_order : categoryId, categoryId),
        updated_at: Timestamp.now(),
      },
      { merge: true }
    );
  }

  await categoryBatch.commit();

  const categoryNameById = new Map<number, string>();
  const categorySlugById = new Map<number, string>();
  for (const category of mergedCategories.values()) {
    categoryNameById.set(normalizeNumber(category.category_id), String(category.name || "").trim());
    categorySlugById.set(
      normalizeNumber(category.category_id),
      "slug" in category && category.slug ? category.slug : getCategorySlug(String(category.name || "").trim())
    );
  }

  const productBatch = firestore.batch();
  for (const product of productRows) {
    const productId = normalizeNumber(product.product_id);
    const categoryId = normalizeNumber(product.category_id);

    productBatch.set(
      productsCollection.doc(`product-${productId}`),
      {
        product_id: productId,
        slug: slugify(String(product.name || "").trim()) || `product-${productId}`,
        name: String(product.name || "").trim(),
        sub_name: normalizeNullableString(product.sub_name),
        description: normalizeNullableString(product.description),
        details: normalizeNullableString(product.details),
        specifications: normalizeNullableString(product.specifications),
        price: normalizeNumber(product.price),
        stock_quantity: normalizeNumber(product.stock_quantity, 0),
        category_id: categoryId,
        category_name: normalizeNullableString(product.category_name) || categoryNameById.get(categoryId) || null,
        category_slug: categorySlugById.get(categoryId) || null,
        image_url: normalizeNullableString(product.image_url),
        image_url1: normalizeNullableString(product.image_url1),
        image_url2: normalizeNullableString(product.image_url2),
        image_url3: normalizeNullableString(product.image_url3),
        is_active: true,
        created_at: toTimestamp(product.created_at),
        updated_at: Timestamp.now(),
      },
      { merge: true }
    );
  }

  await productBatch.commit();

  console.log(
    `Firestore catalog sync complete. Categories: ${mergedCategories.size}, products: ${productRows.length}.`
  );

  await pool.end();
}

void main().catch((error) => {
  console.error("Firestore catalog sync failed:", error);
  process.exitCode = 1;
});
