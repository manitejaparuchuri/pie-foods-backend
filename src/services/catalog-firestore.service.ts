import { Timestamp } from "firebase-admin/firestore";

import {
  getFirestoreBannersCollectionName,
  getFirestoreCategoriesCollectionName,
  getFirestoreCombosCollectionName,
  getFirestorePopularProductsCollectionName,
  getFirestoreProductsCollectionName,
} from "../config/catalog";
import { firestore } from "../config/firebase";

type CategoryRecord = {
  category_id: number;
  slug?: string;
  name: string;
  description: string | null;
  image_url: string | null;
  sort_order?: number;
};

type ProductRecord = {
  product_id: number;
  slug?: string;
  name: string;
  sub_name?: string | null;
  description?: string | null;
  details?: string | null;
  specifications?: string | null;
  price: number;
  stock_quantity?: number | null;
  category_id?: number | null;
  category_name?: string | null;
  category_slug?: string | null;
  image_url?: string | null;
  image_url1?: string | null;
  image_url2?: string | null;
  image_url3?: string | null;
  image_url4?: string | null;
  image_url5?: string | null;
  created_at?: Timestamp | Date | string | null;
  updated_at?: Timestamp | Date | string | null;
  is_active?: boolean;
};

type ComboRecord = {
  combo_id: number;
  slug?: string;
  name: string;
  description: string | null;
  badge: string | null;
  product_ids: number[];
  discount_percent: number;
  is_active: boolean;
  sort_order: number;
  created_at?: Timestamp | Date | string | null;
  updated_at?: Timestamp | Date | string | null;
};

type BannerChipRecord = {
  icon: string;
  label: string;
};

type BannerCtaRecord = {
  text: string;
  link: string;
};

type BannerRecord = {
  banner_id: number;
  slug?: string;
  image_url: string | null;
  caption: string;
  title_top: string;
  title_accent: string;
  title_bottom: string | null;
  description: string | null;
  chips: BannerChipRecord[];
  primary_cta: BannerCtaRecord;
  secondary_cta: BannerCtaRecord | null;
  align: "left" | "right";
  is_active: boolean;
  sort_order: number;
  created_at?: Timestamp | Date | string | null;
  updated_at?: Timestamp | Date | string | null;
};

type PopularProductItemRecord = {
  item_id: number;
  name: string;
  tagline: string | null;
  caption: string | null;
  button_text: string | null;
  link: string | null;
  image_url: string | null;
  is_featured: boolean;
  is_active: boolean;
  sort_order: number;
};

type PopularProductShowcaseRecord = {
  section_id: string;
  eyebrow: string;
  title: string;
  is_active: boolean;
  items: PopularProductItemRecord[];
  created_at?: Timestamp | Date | string | null;
  updated_at?: Timestamp | Date | string | null;
};

type CategoryWritePayload = {
  category_id: number;
  name: string;
  description?: string | null;
  image_url?: string | null;
  slug?: string | null;
  sort_order?: number | null;
};

type ProductWritePayload = {
  product_id: number;
  name: string;
  sub_name?: string | null;
  description?: string | null;
  details?: string | null;
  specifications?: string | null;
  counter_details?: string | null;
  warranty_installation?: string | null;
  price: number;
  stock_quantity?: number | null;
  category_id?: number | null;
  category_name?: string | null;
  category_slug?: string | null;
  image_url?: string | null;
  image_url1?: string | null;
  image_url2?: string | null;
  image_url3?: string | null;
  image_url4?: string | null;
  image_url5?: string | null;
  image_url6?: string | null;
  image_url7?: string | null;
  image_url8?: string | null;
  image_url9?: string | null;
  image_url10?: string | null;
  is_active?: boolean | number | null;
  created_at?: Timestamp | Date | string | null;
};

type ComboWritePayload = {
  combo_id?: number | null;
  name: string;
  description?: string | null;
  badge?: string | null;
  product_ids?: unknown;
  discount_percent?: number | string | null;
  is_active?: boolean | number | string | null;
  sort_order?: number | string | null;
};

type BannerWritePayload = {
  banner_id?: number | null;
  image_url?: string | null;
  caption: string;
  title_top: string;
  title_accent: string;
  title_bottom?: string | null;
  description?: string | null;
  chips?: unknown;
  primary_cta?: unknown;
  secondary_cta?: unknown;
  align?: string | null;
  is_active?: boolean | number | string | null;
  sort_order?: number | string | null;
};

type PopularProductItemWritePayload = {
  item_id?: number | string | null;
  name?: string | null;
  tagline?: string | null;
  caption?: string | null;
  button_text?: string | null;
  link?: string | null;
  image_url?: string | null;
  is_featured?: boolean | number | string | null;
  is_active?: boolean | number | string | null;
  sort_order?: number | string | null;
};

type PopularProductShowcaseWritePayload = {
  eyebrow?: string | null;
  title?: string | null;
  is_active?: boolean | number | string | null;
  items?: PopularProductItemWritePayload[] | null;
};

const ALLOWED_BANNER_CHIP_ICONS = new Set(["leaf", "zero", "gi", "fruit", "drop", "sparkle", "box"]);
const POPULAR_SHOWCASE_DOC_ID = "main";

const DEFAULT_POPULAR_PRODUCT_ITEMS: PopularProductItemRecord[] = [
  {
    item_id: 1,
    name: "Gala Apples",
    tagline: "Crisp & Sweet",
    caption: "Best Seller",
    button_text: "View Gala Apples",
    link: "/products",
    image_url: "/assets/images/banner_model_1.png",
    is_featured: false,
    is_active: true,
    sort_order: 10,
  },
  {
    item_id: 2,
    name: "Golden Mangoes",
    tagline: "Tropical Bliss",
    caption: "Best Seller",
    button_text: "View Golden Mangoes",
    link: "/products",
    image_url: "/assets/images/banner_model_2.png",
    is_featured: false,
    is_active: true,
    sort_order: 20,
  },
  {
    item_id: 3,
    name: "Mixed Berries",
    tagline: "Antioxidant Power",
    caption: "Best Seller",
    button_text: "View Mixed Berries",
    link: "/products",
    image_url: "/assets/images/banner_model_3.png",
    is_featured: false,
    is_active: true,
    sort_order: 30,
  },
  {
    item_id: 4,
    name: "Leafy Spinach",
    tagline: "Farm Fresh",
    caption: "Best Seller",
    button_text: "View Leafy Spinach",
    link: "/products",
    image_url: "/assets/images/banner_model_4.png",
    is_featured: true,
    is_active: true,
    sort_order: 40,
  },
  {
    item_id: 5,
    name: "Zesty Lemons",
    tagline: "Citrus Kick",
    caption: "Best Seller",
    button_text: "View Zesty Lemons",
    link: "/products",
    image_url: "/assets/images/banner_model_1.png",
    is_featured: false,
    is_active: true,
    sort_order: 50,
  },
];

const DEFAULT_POPULAR_SHOWCASE: PopularProductShowcaseRecord = {
  section_id: POPULAR_SHOWCASE_DOC_ID,
  eyebrow: "Curated Selection",
  title: "Popular Products",
  is_active: true,
  items: DEFAULT_POPULAR_PRODUCT_ITEMS,
};

function normalizeNullableString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<number>();
  const normalized: number[] = [];

  for (const item of value) {
    const parsed = normalizeNumber(item, 0);
    if (parsed > 0 && !seen.has(parsed)) {
      seen.add(parsed);
      normalized.push(parsed);
    }
  }

  return normalized;
}

function normalizeBannerChips(value: unknown): BannerChipRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((chip) => {
      if (!chip || typeof chip !== "object") {
        return null;
      }

      const rawChip = chip as Record<string, unknown>;
      const icon = String(rawChip.icon || "").trim();
      const label = String(rawChip.label || "").trim();

      if (!ALLOWED_BANNER_CHIP_ICONS.has(icon) || !label) {
        return null;
      }

      return { icon, label };
    })
    .filter((chip): chip is BannerChipRecord => Boolean(chip))
    .slice(0, 4);
}

function normalizeBannerCta(value: unknown, fallback: BannerCtaRecord): BannerCtaRecord {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const rawCta = value as Record<string, unknown>;
  const text = String(rawCta.text || "").trim();
  const link = String(rawCta.link || "").trim();

  return {
    text: text || fallback.text,
    link: link || fallback.link,
  };
}

function normalizeOptionalBannerCta(value: unknown): BannerCtaRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawCta = value as Record<string, unknown>;
  const text = String(rawCta.text || "").trim();
  const link = String(rawCta.link || "").trim();

  if (!text || !link) {
    return null;
  }

  return { text, link };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = normalizeNumber(value, fallback);
  return Math.min(Math.max(parsed, min), max);
}

function slugify(value: unknown, fallback: string): string {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function mapCategoryRecord(raw: Record<string, unknown>): CategoryRecord {
  return {
    category_id: normalizeNumber(raw.category_id),
    slug: normalizeNullableString(raw.slug) || undefined,
    name: String(raw.name ?? "").trim(),
    description: normalizeNullableString(raw.description),
    image_url: normalizeNullableString(raw.image_url),
    sort_order: normalizeNumber(raw.sort_order, normalizeNumber(raw.category_id)),
  };
}

function mapProductRecord(raw: Record<string, unknown>): ProductRecord {
  return {
    product_id: normalizeNumber(raw.product_id),
    slug: normalizeNullableString(raw.slug) || undefined,
    name: String(raw.name ?? "").trim(),
    sub_name: normalizeNullableString(raw.sub_name),
    description: normalizeNullableString(raw.description),
    details: normalizeNullableString(raw.details),
    specifications: normalizeNullableString(raw.specifications),
    price: normalizeNumber(raw.price),
    stock_quantity: normalizeNumber(raw.stock_quantity, 0),
    category_id: normalizeNumber(raw.category_id, 0),
    category_name: normalizeNullableString(raw.category_name),
    category_slug: normalizeNullableString(raw.category_slug),
    image_url: normalizeNullableString(raw.image_url),
    image_url1: normalizeNullableString(raw.image_url1),
    image_url2: normalizeNullableString(raw.image_url2),
    image_url3: normalizeNullableString(raw.image_url3),
    image_url4: normalizeNullableString(raw.image_url4),
    image_url5: normalizeNullableString(raw.image_url5),
    created_at:
      raw.created_at instanceof Timestamp || raw.created_at instanceof Date || typeof raw.created_at === "string"
        ? (raw.created_at as Timestamp | Date | string)
        : null,
    updated_at:
      raw.updated_at instanceof Timestamp || raw.updated_at instanceof Date || typeof raw.updated_at === "string"
        ? (raw.updated_at as Timestamp | Date | string)
        : null,
    is_active: raw.is_active === undefined ? true : Boolean(raw.is_active),
  };
}

function mapComboRecord(raw: Record<string, unknown>): ComboRecord {
  const comboId = normalizeNumber(raw.combo_id);
  return {
    combo_id: comboId,
    slug: normalizeNullableString(raw.slug) || undefined,
    name: String(raw.name ?? "").trim(),
    description: normalizeNullableString(raw.description),
    badge: normalizeNullableString(raw.badge),
    product_ids: normalizeNumberArray(raw.product_ids),
    discount_percent: clampNumber(raw.discount_percent, 0, 90, 10),
    is_active: raw.is_active === undefined ? true : Boolean(raw.is_active),
    sort_order: normalizeNumber(raw.sort_order, comboId),
    created_at:
      raw.created_at instanceof Timestamp || raw.created_at instanceof Date || typeof raw.created_at === "string"
        ? (raw.created_at as Timestamp | Date | string)
        : null,
    updated_at:
      raw.updated_at instanceof Timestamp || raw.updated_at instanceof Date || typeof raw.updated_at === "string"
        ? (raw.updated_at as Timestamp | Date | string)
        : null,
  };
}

function mapBannerRecord(raw: Record<string, unknown>): BannerRecord {
  const bannerId = normalizeNumber(raw.banner_id);
  const titleTop = String(raw.title_top ?? "").trim();
  return {
    banner_id: bannerId,
    slug: normalizeNullableString(raw.slug) || undefined,
    image_url: normalizeNullableString(raw.image_url),
    caption: String(raw.caption ?? "").trim(),
    title_top: titleTop,
    title_accent: String(raw.title_accent ?? "").trim(),
    title_bottom: normalizeNullableString(raw.title_bottom),
    description: normalizeNullableString(raw.description),
    chips: normalizeBannerChips(raw.chips),
    primary_cta: normalizeBannerCta(raw.primary_cta, { text: "Shop Now", link: "/products" }),
    secondary_cta: normalizeOptionalBannerCta(raw.secondary_cta),
    align: raw.align === "right" ? "right" : "left",
    is_active: raw.is_active === undefined ? true : Boolean(raw.is_active),
    sort_order: normalizeNumber(raw.sort_order, bannerId),
    created_at:
      raw.created_at instanceof Timestamp || raw.created_at instanceof Date || typeof raw.created_at === "string"
        ? (raw.created_at as Timestamp | Date | string)
        : null,
    updated_at:
      raw.updated_at instanceof Timestamp || raw.updated_at instanceof Date || typeof raw.updated_at === "string"
        ? (raw.updated_at as Timestamp | Date | string)
        : null,
  };
}

function mapPopularProductItemRecord(raw: Record<string, unknown>, fallbackIndex: number): PopularProductItemRecord {
  const fallbackId = fallbackIndex + 1;
  const itemId = normalizeNumber(raw.item_id, fallbackId);
  const name = String(raw.name ?? "").trim();
  return {
    item_id: itemId || fallbackId,
    name,
    tagline: normalizeNullableString(raw.tagline),
    caption: normalizeNullableString(raw.caption) || "Best Seller",
    button_text: normalizeNullableString(raw.button_text) || (name ? `View ${name}` : "View Product"),
    link: normalizeNullableString(raw.link) || "/products",
    image_url: normalizeNullableString(raw.image_url),
    is_featured: raw.is_featured === undefined ? false : Boolean(raw.is_featured),
    is_active: raw.is_active === undefined ? true : Boolean(raw.is_active),
    sort_order: normalizeNumber(raw.sort_order, itemId || fallbackId),
  };
}

function mapPopularProductShowcaseRecord(raw: Record<string, unknown>): PopularProductShowcaseRecord {
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items = rawItems
    .map((item, index) =>
      item && typeof item === "object"
        ? mapPopularProductItemRecord(item as Record<string, unknown>, index)
        : null
    )
    .filter((item): item is PopularProductItemRecord => Boolean(item));

  return {
    section_id: String(raw.section_id || POPULAR_SHOWCASE_DOC_ID).trim() || POPULAR_SHOWCASE_DOC_ID,
    eyebrow: String(raw.eyebrow || DEFAULT_POPULAR_SHOWCASE.eyebrow).trim(),
    title: String(raw.title || DEFAULT_POPULAR_SHOWCASE.title).trim(),
    is_active: raw.is_active === undefined ? true : Boolean(raw.is_active),
    items: sortPopularProductItems(items.length ? items : DEFAULT_POPULAR_PRODUCT_ITEMS),
    created_at:
      raw.created_at instanceof Timestamp || raw.created_at instanceof Date || typeof raw.created_at === "string"
        ? (raw.created_at as Timestamp | Date | string)
        : null,
    updated_at:
      raw.updated_at instanceof Timestamp || raw.updated_at instanceof Date || typeof raw.updated_at === "string"
        ? (raw.updated_at as Timestamp | Date | string)
        : null,
  };
}

function toFirestoreBoolean(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function toFirestoreDate(value: unknown): Timestamp {
  if (value instanceof Timestamp) {
    return value;
  }
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

function sortCategories(categories: CategoryRecord[]): CategoryRecord[] {
  return [...categories].sort((left, right) => {
    const leftOrder = Number.isFinite(Number(left.sort_order)) ? Number(left.sort_order) : left.category_id;
    const rightOrder = Number.isFinite(Number(right.sort_order)) ? Number(right.sort_order) : right.category_id;
    return leftOrder - rightOrder;
  });
}

function sortProducts(products: ProductRecord[]): ProductRecord[] {
  return [...products].sort((left, right) => {
    const createdDiff = toMillis(right.created_at) - toMillis(left.created_at);
    if (createdDiff !== 0) {
      return createdDiff;
    }

    return right.product_id - left.product_id;
  });
}

function sortCombos(combos: ComboRecord[]): ComboRecord[] {
  return [...combos].sort((left, right) => {
    const orderDiff = normalizeNumber(left.sort_order, left.combo_id) - normalizeNumber(right.sort_order, right.combo_id);
    return orderDiff || left.combo_id - right.combo_id;
  });
}

function sortBanners(banners: BannerRecord[]): BannerRecord[] {
  return [...banners].sort((left, right) => {
    const orderDiff = normalizeNumber(left.sort_order, left.banner_id) - normalizeNumber(right.sort_order, right.banner_id);
    return orderDiff || left.banner_id - right.banner_id;
  });
}

function sortPopularProductItems(items: PopularProductItemRecord[]): PopularProductItemRecord[] {
  return [...items].sort((left, right) => {
    const orderDiff = normalizeNumber(left.sort_order, left.item_id) - normalizeNumber(right.sort_order, right.item_id);
    return orderDiff || left.item_id - right.item_id;
  });
}

class FirestoreCatalogService {
  private readonly categoriesCollection = firestore.collection(getFirestoreCategoriesCollectionName());
  private readonly productsCollection = firestore.collection(getFirestoreProductsCollectionName());
  private readonly combosCollection = firestore.collection(getFirestoreCombosCollectionName());
  private readonly bannersCollection = firestore.collection(getFirestoreBannersCollectionName());
  private readonly popularProductsCollection = firestore.collection(getFirestorePopularProductsCollectionName());

  async getAllCategories(): Promise<CategoryRecord[]> {
    const snapshot = await this.categoriesCollection.get();
    return sortCategories(snapshot.docs.map((doc) => mapCategoryRecord(doc.data())));
  }

  async getCategoryById(categoryId: number): Promise<CategoryRecord | null> {
    const snapshot = await this.categoriesCollection
      .where("category_id", "==", categoryId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return mapCategoryRecord(snapshot.docs[0].data());
  }

  async getAllProducts(): Promise<ProductRecord[]> {
    const snapshot = await this.productsCollection.where("is_active", "==", true).get();
    return sortProducts(snapshot.docs.map((doc) => mapProductRecord(doc.data())));
  }

  async getAllProductsForAdmin(): Promise<ProductRecord[]> {
    const snapshot = await this.productsCollection.get();
    return sortProducts(snapshot.docs.map((doc) => mapProductRecord(doc.data())));
  }

  async getAllCombos(): Promise<ComboRecord[]> {
    const snapshot = await this.combosCollection.get();
    return sortCombos(snapshot.docs.map((doc) => mapComboRecord(doc.data())));
  }

  async getActiveCombos(): Promise<ComboRecord[]> {
    const snapshot = await this.combosCollection.where("is_active", "==", true).get();
    return sortCombos(snapshot.docs.map((doc) => mapComboRecord(doc.data())));
  }

  async getAllBanners(): Promise<BannerRecord[]> {
    const snapshot = await this.bannersCollection.get();
    return sortBanners(snapshot.docs.map((doc) => mapBannerRecord(doc.data())));
  }

  async getActiveBanners(): Promise<BannerRecord[]> {
    const snapshot = await this.bannersCollection.where("is_active", "==", true).get();
    return sortBanners(snapshot.docs.map((doc) => mapBannerRecord(doc.data())));
  }

  async getPopularProductShowcase(): Promise<PopularProductShowcaseRecord> {
    const snapshot = await this.popularProductsCollection.doc(POPULAR_SHOWCASE_DOC_ID).get();
    if (!snapshot.exists) {
      return {
        ...DEFAULT_POPULAR_SHOWCASE,
        items: DEFAULT_POPULAR_SHOWCASE.items.map((item) => ({ ...item })),
      };
    }

    return mapPopularProductShowcaseRecord(snapshot.data() || {});
  }

  async getProductById(productId: number): Promise<ProductRecord | null> {
    const snapshot = await this.productsCollection
      .where("product_id", "==", productId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return mapProductRecord(snapshot.docs[0].data());
  }

  async getProductsByCategory(categoryId: number): Promise<ProductRecord[]> {
    const snapshot = await this.productsCollection
      .where("category_id", "==", categoryId)
      .where("is_active", "==", true)
      .get();

    return sortProducts(snapshot.docs.map((doc) => mapProductRecord(doc.data())));
  }

  async getCategoriesWithProducts(): Promise<
    Array<{
      category_id: number;
      slug?: string;
      name: string;
      description: string | null;
      image_url: string | null;
      products: Array<{
        product_id: number;
        name: string;
        price: number;
        image_url: string | null;
      }>;
    }>
  > {
    const [categories, products] = await Promise.all([
      this.getAllCategories(),
      this.getAllProducts(),
    ]);

    const byCategory = new Map<
      number,
      {
        category_id: number;
        slug?: string;
        name: string;
        description: string | null;
        image_url: string | null;
        products: Array<{
          product_id: number;
          name: string;
          price: number;
          image_url: string | null;
        }>;
      }
    >();

    for (const category of categories) {
      byCategory.set(category.category_id, {
        category_id: category.category_id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        image_url: category.image_url,
        products: [],
      });
    }

    for (const product of products) {
      const category = byCategory.get(Number(product.category_id || 0));
      if (!category) {
        continue;
      }

      category.products.push({
        product_id: product.product_id,
        name: product.name,
        price: product.price,
        image_url: product.image_url || null,
      });
    }

    return Array.from(byCategory.values());
  }

  async upsertCategory(payload: CategoryWritePayload): Promise<CategoryRecord> {
    const category: CategoryRecord = {
      category_id: normalizeNumber(payload.category_id),
      slug: normalizeNullableString(payload.slug) || slugify(payload.name, `category-${payload.category_id}`),
      name: String(payload.name || "").trim(),
      description: normalizeNullableString(payload.description),
      image_url: normalizeNullableString(payload.image_url),
      sort_order: normalizeNumber(payload.sort_order, normalizeNumber(payload.category_id)),
    };

    await this.categoriesCollection.doc(`category-${category.category_id}`).set(
      {
        ...category,
        updated_at: Timestamp.now(),
      },
      { merge: true }
    );

    return category;
  }

  async deleteCategory(categoryId: number): Promise<void> {
    await this.categoriesCollection.doc(`category-${categoryId}`).delete();
  }

  async upsertProduct(payload: ProductWritePayload): Promise<ProductRecord> {
    const productId = normalizeNumber(payload.product_id);
    const categoryId = normalizeNumber(payload.category_id);
    const existingProduct = await this.getProductById(productId);
    const category = categoryId ? await this.getCategoryById(categoryId) : null;

    const productData: Record<string, unknown> = {
      product_id: productId,
      slug: slugify(payload.name, `product-${productId}`),
      name: String(payload.name || "").trim(),
      sub_name: normalizeNullableString(payload.sub_name),
      description: normalizeNullableString(payload.description),
      details: normalizeNullableString(payload.details),
      specifications: normalizeNullableString(payload.specifications),
      counter_details: normalizeNullableString(payload.counter_details),
      warranty_installation: normalizeNullableString(payload.warranty_installation),
      price: normalizeNumber(payload.price),
      stock_quantity: normalizeNumber(payload.stock_quantity, 0),
      category_id: categoryId,
      category_name: normalizeNullableString(payload.category_name) || category?.name || null,
      category_slug: normalizeNullableString(payload.category_slug) || category?.slug || null,
      image_url: normalizeNullableString(payload.image_url),
      image_url1: normalizeNullableString(payload.image_url1),
      image_url2: normalizeNullableString(payload.image_url2),
      image_url3: normalizeNullableString(payload.image_url3),
      image_url4: normalizeNullableString(payload.image_url4),
      image_url5: normalizeNullableString(payload.image_url5),
      image_url6: normalizeNullableString(payload.image_url6),
      image_url7: normalizeNullableString(payload.image_url7),
      image_url8: normalizeNullableString(payload.image_url8),
      image_url9: normalizeNullableString(payload.image_url9),
      image_url10: normalizeNullableString(payload.image_url10),
      is_active: toFirestoreBoolean(payload.is_active, true),
      created_at: existingProduct?.created_at || toFirestoreDate(payload.created_at),
      updated_at: Timestamp.now(),
    };

    await this.productsCollection.doc(`product-${productId}`).set(productData, { merge: true });
    return mapProductRecord(productData);
  }

  async deleteProduct(productId: number): Promise<void> {
    await this.productsCollection.doc(`product-${productId}`).delete();
  }

  async upsertCombo(payload: ComboWritePayload): Promise<ComboRecord> {
    const comboId = normalizeNumber(payload.combo_id, await this.getNextComboId());
    const now = Timestamp.now();
    const existingSnapshot = await this.combosCollection.doc(`combo-${comboId}`).get();
    const existing = existingSnapshot.exists ? mapComboRecord(existingSnapshot.data() || {}) : null;
    const name = String(payload.name || "").trim();

    const comboData: Record<string, unknown> = {
      combo_id: comboId,
      slug: slugify(name, `combo-${comboId}`),
      name,
      description: normalizeNullableString(payload.description),
      badge: normalizeNullableString(payload.badge),
      product_ids: normalizeNumberArray(payload.product_ids),
      discount_percent: clampNumber(payload.discount_percent, 0, 90, 10),
      is_active: toFirestoreBoolean(payload.is_active, true),
      sort_order: normalizeNumber(payload.sort_order, comboId),
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    await this.combosCollection.doc(`combo-${comboId}`).set(comboData, { merge: true });
    return mapComboRecord(comboData);
  }

  async deleteCombo(comboId: number): Promise<void> {
    await this.combosCollection.doc(`combo-${comboId}`).delete();
  }

  async upsertBanner(payload: BannerWritePayload): Promise<BannerRecord> {
    const bannerId = normalizeNumber(payload.banner_id, await this.getNextBannerId());
    const now = Timestamp.now();
    const existingSnapshot = await this.bannersCollection.doc(`banner-${bannerId}`).get();
    const existing = existingSnapshot.exists ? mapBannerRecord(existingSnapshot.data() || {}) : null;
    const titleTop = String(payload.title_top || "").trim();
    const titleAccent = String(payload.title_accent || "").trim();

    const bannerData: Record<string, unknown> = {
      banner_id: bannerId,
      slug: slugify(`${titleTop} ${titleAccent}`, `banner-${bannerId}`),
      image_url: normalizeNullableString(payload.image_url),
      caption: String(payload.caption || "").trim(),
      title_top: titleTop,
      title_accent: titleAccent,
      title_bottom: normalizeNullableString(payload.title_bottom),
      description: normalizeNullableString(payload.description),
      chips: normalizeBannerChips(payload.chips),
      primary_cta: normalizeBannerCta(payload.primary_cta, { text: "Shop Now", link: "/products" }),
      secondary_cta: normalizeOptionalBannerCta(payload.secondary_cta),
      align: payload.align === "right" ? "right" : "left",
      is_active: toFirestoreBoolean(payload.is_active, true),
      sort_order: normalizeNumber(payload.sort_order, bannerId),
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    await this.bannersCollection.doc(`banner-${bannerId}`).set(bannerData, { merge: true });
    return mapBannerRecord(bannerData);
  }

  async deleteBanner(bannerId: number): Promise<void> {
    await this.bannersCollection.doc(`banner-${bannerId}`).delete();
  }

  async upsertPopularProductShowcase(
    payload: PopularProductShowcaseWritePayload
  ): Promise<PopularProductShowcaseRecord> {
    const now = Timestamp.now();
    const existingSnapshot = await this.popularProductsCollection.doc(POPULAR_SHOWCASE_DOC_ID).get();
    const existing = existingSnapshot.exists
      ? mapPopularProductShowcaseRecord(existingSnapshot.data() || {})
      : null;

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items = rawItems
      .map((item, index) => this.normalizePopularProductItemForWrite(item, index))
      .filter((item): item is PopularProductItemRecord => Boolean(item))
      .slice(0, 8);

    if (!items.some((item) => item.is_featured) && items.length) {
      items[0].is_featured = true;
    }

    const showcaseData: PopularProductShowcaseRecord = {
      section_id: POPULAR_SHOWCASE_DOC_ID,
      eyebrow: String(payload.eyebrow || DEFAULT_POPULAR_SHOWCASE.eyebrow).trim() || DEFAULT_POPULAR_SHOWCASE.eyebrow,
      title: String(payload.title || DEFAULT_POPULAR_SHOWCASE.title).trim() || DEFAULT_POPULAR_SHOWCASE.title,
      is_active: toFirestoreBoolean(payload.is_active, true),
      items: sortPopularProductItems(items),
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    await this.popularProductsCollection.doc(POPULAR_SHOWCASE_DOC_ID).set(showcaseData, { merge: true });
    return mapPopularProductShowcaseRecord(showcaseData as unknown as Record<string, unknown>);
  }

  private async getNextComboId(): Promise<number> {
    const combos = await this.getAllCombos();
    const highestId = combos.reduce((highest, combo) => Math.max(highest, combo.combo_id), 0);
    return highestId + 1;
  }

  private async getNextBannerId(): Promise<number> {
    const banners = await this.getAllBanners();
    const highestId = banners.reduce((highest, banner) => Math.max(highest, banner.banner_id), 0);
    return highestId + 1;
  }

  async getNextCategoryId(): Promise<number> {
    const categories = await this.getAllCategories();
    const highestId = categories.reduce(
      (highest, category) => Math.max(highest, Number(category.category_id) || 0),
      0
    );
    return highestId + 1;
  }

  async getNextProductId(): Promise<number> {
    const products = await this.getAllProductsForAdmin();
    const highestId = products.reduce(
      (highest, product) => Math.max(highest, Number(product.product_id) || 0),
      0
    );
    return highestId + 1;
  }

  private normalizePopularProductItemForWrite(
    item: PopularProductItemWritePayload,
    index: number
  ): PopularProductItemRecord | null {
    const name = String(item?.name || "").trim();
    const imageUrl = normalizeNullableString(item?.image_url);

    if (!name || !imageUrl) {
      return null;
    }

    const fallbackId = index + 1;
    const itemId = normalizeNumber(item?.item_id, fallbackId) || fallbackId;

    return {
      item_id: itemId,
      name,
      tagline: normalizeNullableString(item?.tagline),
      caption: normalizeNullableString(item?.caption) || "Best Seller",
      button_text: normalizeNullableString(item?.button_text) || `View ${name}`,
      link: normalizeNullableString(item?.link) || "/products",
      image_url: imageUrl,
      is_featured: toFirestoreBoolean(item?.is_featured, false),
      is_active: toFirestoreBoolean(item?.is_active, true),
      sort_order: normalizeNumber(item?.sort_order, (index + 1) * 10),
    };
  }
}

export default new FirestoreCatalogService();
