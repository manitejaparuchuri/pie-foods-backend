import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  getFirestoreBannersCollectionName,
  getFirestoreCategoriesCollectionName,
  getFirestoreCombosCollectionName,
  getFirestorePopularProductsCollectionName,
  getFirestoreProductsCollectionName,
  getFirestoreSiteSettingsCollectionName,
} from "../config/catalog";
import { firestore } from "../config/firebase";
import { ORDER_DISCOUNT_RATE } from "./pricing.service";

/** Discount applied to products that predate the per-product discount field. */
const DEFAULT_PRODUCT_DISCOUNT_PERCENT = Math.round(ORDER_DISCOUNT_RATE * 100);

type CategoryRecord = {
  category_id: number;
  slug?: string;
  name: string;
  sort_order?: number;
};

type ProductRecord = {
  product_id: number;
  slug?: string;
  name: string;
  sub_name?: string | null;
  description?: string | null;
  price: number;
  discount_percent: number;
  /** Per-product inclusive GST rate (e.g. 5, 12, 18). Defaults to 5 when missing. */
  tax_percent: number;
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
  is_bestseller?: boolean;
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
  mobile_image_url?: string | null;
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
  slug?: string | null;
  sort_order?: number | null;
};

type ProductWritePayload = {
  product_id: number;
  name: string;
  sub_name?: string | null;
  description?: string | null;
  price: number;
  discount_percent?: number | string | null;
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
  is_bestseller?: boolean | number | string | null;
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

type TrialPackRecord = {
  price: number;
  currency: string;
  unit_label: string;
  pack_label: string;
  cups_label: string;
  is_active: boolean;
  created_at?: Timestamp | Date | string | null;
  updated_at?: Timestamp | Date | string | null;
};

type TrialPackWritePayload = {
  price?: number | string | null;
  currency?: string | null;
  unit_label?: string | null;
  pack_label?: string | null;
  cups_label?: string | null;
  is_active?: boolean | number | string | null;
};

const ALLOWED_BANNER_CHIP_ICONS = new Set(["leaf", "zero", "gi", "fruit", "drop", "sparkle", "box"]);
const POPULAR_SHOWCASE_DOC_ID = "main";

const DEFAULT_BANNERS: BannerRecord[] = [
  {
    banner_id: 1,
    image_url: "/assets/images/banner 2.jpg.jpeg",
    caption: "SWEETNESS, WITHOUT COMPROMISE",
    title_top: "Sweetness,",
    title_accent: "Better Than",
    title_bottom: "Sugar.",
    description:
      "Pure monk fruit sweetener — zero calories, zero glycemic impact, zero guilt. A clean, everyday switch for chai, coffee, and Indian cooking.",
    chips: [
      { icon: "zero", label: "Zero Calories" },
      { icon: "gi", label: "GI = 0" },
      { icon: "leaf", label: "100% Natural" },
    ],
    primary_cta: { text: "Shop Now", link: "/products?category=monk-fruit-sweetener" },
    secondary_cta: { text: "Know More", link: "/learn#monk-fruit-guide" },
    align: "left",
    is_active: true,
    sort_order: 10,
  },
  {
    banner_id: 2,
    image_url: "/assets/images/banner 3.jpg.jpeg",
    caption: "EVERYDAY RITUALS",
    title_top: "A Drop",
    title_accent: "of Pure",
    title_bottom: "Sweetness.",
    description:
      "Drop. Stir. Sip. Our monk fruit liquid drops dissolve cleanly into coffee, tea, and everything you love.",
    chips: [
      { icon: "drop", label: "Liquid Form" },
      { icon: "sparkle", label: "Zero Sugar" },
      { icon: "leaf", label: "Plant-Based" },
    ],
    primary_cta: { text: "Shop Now", link: "/products?category=monk-fruit-sweetener" },
    secondary_cta: { text: "Know More", link: "/learn#monk-fruit-guide" },
    align: "left",
    is_active: true,
    sort_order: 20,
  },
  {
    banner_id: 3,
    image_url: "/assets/images/banner1.jpg",
    caption: "100% Real Fruit",
    title_top: "Real Fruit.",
    title_accent: "Nothing Else.",
    title_bottom: null,
    description:
      "Freeze-dried to preserve taste, texture, and nutrition — without added sugar or preservatives. Perfect for snacking, breakfast, and on-the-go.",
    chips: [
      { icon: "fruit", label: "100% Real Fruit" },
      { icon: "sparkle", label: "No Added Sugar" },
      { icon: "leaf", label: "No Preservatives" },
    ],
    primary_cta: { text: "Shop Now", link: "/products?category=freeze-dried-fruits" },
    secondary_cta: { text: "Know More", link: "/learn#freeze-drying-process" },
    align: "left",
    is_active: true,
    sort_order: 30,
  },
];

const DEFAULT_POPULAR_PRODUCT_ITEMS: PopularProductItemRecord[] = [
  {
    item_id: 1,
    name: "Monk Fruit Sweetener",
    tagline: "Zero Calorie · Zero GI",
    caption: "Best Seller",
    button_text: "View Monk Fruit Sweetener",
    link: "/products",
    image_url: "/assets/images/popular_monk_fruit_sweetener.png",
    is_featured: true,
    is_active: true,
    sort_order: 10,
  },
  {
    item_id: 2,
    name: "Strawberry Pie Chips",
    tagline: "Berry-Bright Crunch",
    caption: "Best Seller",
    button_text: "View Strawberry Pie Chips",
    link: "/products",
    image_url: "/assets/images/popular_strawberry_chips.png",
    is_featured: false,
    is_active: true,
    sort_order: 20,
  },
  {
    item_id: 3,
    name: "Pineapple Pie Chips",
    tagline: "Tropical Crunch",
    caption: "Best Seller",
    button_text: "View Pineapple Pie Chips",
    link: "/products",
    image_url: "/assets/images/popular_pineapple_chips.png",
    is_featured: false,
    is_active: true,
    sort_order: 30,
  },
  {
    item_id: 4,
    name: "Mango Pie Chips",
    tagline: "Sunny Mango Crunch",
    caption: "Best Seller",
    button_text: "View Mango Pie Chips",
    link: "/products",
    image_url: "/assets/images/popular_mango_chips.png",
    is_featured: false,
    is_active: true,
    sort_order: 40,
  },
  {
    item_id: 5,
    name: "Jamun Pie Bites",
    tagline: "Dark Fruit Crunch",
    caption: "New Arrival",
    button_text: "View Jamun Pie Bites",
    link: "/products",
    image_url: "/assets/images/popular_jamun_chips.png",
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

const TRIAL_PACK_DOC_ID = "trial_pack";

const DEFAULT_TRIAL_PACK: TrialPackRecord = {
  price: 99,
  currency: "₹",
  unit_label: "10 sachets",
  pack_label: "trial pack",
  cups_label: "10 cups of chai",
  is_active: true,
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
    price: normalizeNumber(raw.price),
    discount_percent:
      raw.discount_percent === undefined || raw.discount_percent === null
        ? DEFAULT_PRODUCT_DISCOUNT_PERCENT
        : clampNumber(raw.discount_percent, 0, 90, DEFAULT_PRODUCT_DISCOUNT_PERCENT),
    tax_percent:
      raw.tax_percent === undefined || raw.tax_percent === null
        ? 5
        : clampNumber(raw.tax_percent, 0, 50, 5),
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
    is_bestseller: raw.is_bestseller === true || Number(raw.is_bestseller) === 1,
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
    mobile_image_url: normalizeNullableString(raw.mobile_image_url),
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

function mapTrialPackRecord(raw: Record<string, unknown>): TrialPackRecord {
  const price = normalizeNumber(raw.price, DEFAULT_TRIAL_PACK.price);
  return {
    price: price > 0 ? price : DEFAULT_TRIAL_PACK.price,
    currency: String(raw.currency || DEFAULT_TRIAL_PACK.currency).trim() || DEFAULT_TRIAL_PACK.currency,
    unit_label: String(raw.unit_label || DEFAULT_TRIAL_PACK.unit_label).trim() || DEFAULT_TRIAL_PACK.unit_label,
    pack_label: String(raw.pack_label || DEFAULT_TRIAL_PACK.pack_label).trim() || DEFAULT_TRIAL_PACK.pack_label,
    cups_label: String(raw.cups_label || DEFAULT_TRIAL_PACK.cups_label).trim() || DEFAULT_TRIAL_PACK.cups_label,
    is_active: raw.is_active === undefined ? true : Boolean(raw.is_active),
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
  private readonly siteSettingsCollection = firestore.collection(getFirestoreSiteSettingsCollectionName());

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
    if (snapshot.empty) {
      return sortBanners(await this.seedDefaultBanners());
    }
    return sortBanners(snapshot.docs.map((doc) => mapBannerRecord(doc.data())));
  }

  async getActiveBanners(): Promise<BannerRecord[]> {
    const all = await this.getAllBanners();
    return all.filter((banner) => banner.is_active);
  }

  private async seedDefaultBanners(): Promise<BannerRecord[]> {
    const now = Timestamp.now();
    const batch = firestore.batch();
    const seeded: BannerRecord[] = [];

    for (const banner of DEFAULT_BANNERS) {
      const titleTop = banner.title_top.trim();
      const titleAccent = banner.title_accent.trim();
      const data: Record<string, unknown> = {
        banner_id: banner.banner_id,
        slug: slugify(`${titleTop} ${titleAccent}`, `banner-${banner.banner_id}`),
        image_url: banner.image_url,
        caption: banner.caption,
        title_top: titleTop,
        title_accent: titleAccent,
        title_bottom: banner.title_bottom,
        description: banner.description,
        chips: banner.chips,
        primary_cta: banner.primary_cta,
        secondary_cta: banner.secondary_cta,
        align: banner.align,
        is_active: banner.is_active,
        sort_order: banner.sort_order,
        created_at: now,
        updated_at: now,
      };
      batch.set(this.bannersCollection.doc(`banner-${banner.banner_id}`), data, { merge: true });
      seeded.push(mapBannerRecord(data));
    }

    await batch.commit();
    return seeded;
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

  async getTrialPack(): Promise<TrialPackRecord> {
    const snapshot = await this.siteSettingsCollection.doc(TRIAL_PACK_DOC_ID).get();
    if (!snapshot.exists) {
      return { ...DEFAULT_TRIAL_PACK };
    }

    return mapTrialPackRecord(snapshot.data() || {});
  }

  async upsertTrialPack(payload: TrialPackWritePayload): Promise<TrialPackRecord> {
    const now = Timestamp.now();
    const existingSnapshot = await this.siteSettingsCollection.doc(TRIAL_PACK_DOC_ID).get();
    const existing = existingSnapshot.exists ? mapTrialPackRecord(existingSnapshot.data() || {}) : null;

    const price = normalizeNumber(payload.price, existing?.price ?? DEFAULT_TRIAL_PACK.price);

    const trialPackData: Record<string, unknown> = {
      price: price > 0 ? price : DEFAULT_TRIAL_PACK.price,
      currency: String(payload.currency || existing?.currency || DEFAULT_TRIAL_PACK.currency).trim() || DEFAULT_TRIAL_PACK.currency,
      unit_label: String(payload.unit_label || existing?.unit_label || DEFAULT_TRIAL_PACK.unit_label).trim() || DEFAULT_TRIAL_PACK.unit_label,
      pack_label: String(payload.pack_label || existing?.pack_label || DEFAULT_TRIAL_PACK.pack_label).trim() || DEFAULT_TRIAL_PACK.pack_label,
      cups_label: String(payload.cups_label || existing?.cups_label || DEFAULT_TRIAL_PACK.cups_label).trim() || DEFAULT_TRIAL_PACK.cups_label,
      is_active: toFirestoreBoolean(payload.is_active, existing?.is_active ?? true),
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    await this.siteSettingsCollection.doc(TRIAL_PACK_DOC_ID).set(trialPackData, { merge: true });
    return mapTrialPackRecord(trialPackData);
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
      sort_order: normalizeNumber(payload.sort_order, normalizeNumber(payload.category_id)),
    };

    await this.categoriesCollection.doc(`category-${category.category_id}`).set(
      {
        ...category,
        // Strip retired fields from existing docs on save.
        description: FieldValue.delete(),
        image_url: FieldValue.delete(),
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
      // Strip retired fields from existing docs on save.
      details: FieldValue.delete(),
      specifications: FieldValue.delete(),
      counter_details: FieldValue.delete(),
      warranty_installation: FieldValue.delete(),
      price: normalizeNumber(payload.price),
      discount_percent:
        payload.discount_percent === undefined || payload.discount_percent === null
          ? existingProduct?.discount_percent ?? DEFAULT_PRODUCT_DISCOUNT_PERCENT
          : clampNumber(payload.discount_percent, 0, 90, DEFAULT_PRODUCT_DISCOUNT_PERCENT),
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
      is_bestseller: toFirestoreBoolean(payload.is_bestseller, existingProduct?.is_bestseller ?? false),
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
