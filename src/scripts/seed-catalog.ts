import dotenv from "dotenv";
import { readFile } from "fs/promises";
import path from "path";

import db from "../config/db";

dotenv.config({ override: true });

const MANIFEST_PATH = path.join(process.cwd(), "tmp", "r2-upload-manifest.json");

type ManifestEntry = {
  assetPath: string;
  publicUrl: string;
};

type CategorySeed = {
  name: string;
  description: string;
  imagePath: string;
};

type ProductSeed = {
  name: string;
  categoryName: string;
  subName: string;
  description: string;
  specifications: string;
  details: string;
  price: number;
  stockQuantity: number;
  imagePaths: string[];
};

const CATEGORY_SEEDS: CategorySeed[] = [
  {
    name: "Fruit Chips",
    description:
      "Light, crunchy fruit-forward snacks made for clean everyday munching and vibrant gifting.",
    imagePath: "Apple-Pie-chips-Mockup-1.png",
  },
  {
    name: "Natural Sweeteners",
    description:
      "Better-for-you sweetness crafted for modern kitchens, beverages, and mindful daily rituals.",
    imagePath: "PIE-Monk-Fruit-Pouch-Mockup1.png",
  },
];

const PRODUCT_SEEDS: ProductSeed[] = [
  {
    name: "Apple Pie Chips",
    categoryName: "Fruit Chips",
    subName: "Crisp orchard apple bites with a naturally bright finish.",
    description:
      "PIE Apple Pie Chips are made for clean snacking moments when you want fruit-led crunch without the heaviness of fried junk food. The profile is crisp, familiar, and gently sweet, making it an easy everyday pick for school boxes, office breaks, and travel packs.",
    specifications:
      "Format: Ready-to-eat fruit chips. Texture: Light and crunchy. Best for: Midday snacking, lunch boxes, gifting hampers.",
    details:
      "Serve straight from the pack, add to yogurt bowls, or use as a topping over oats and smoothie bowls for extra crunch.",
    price: 249,
    stockQuantity: 120,
    imagePaths: ["Apple-Pie-chips-Mockup-1.png", "Apple-Pie-chips-Mockup-2.png"],
  },
  {
    name: "Banana Pie Chips",
    categoryName: "Fruit Chips",
    subName: "Golden banana crunch with a mellow, comforting sweetness.",
    description:
      "PIE Banana Pie Chips bring together a familiar fruit taste and a satisfying snap that works for all age groups. They are ideal when you want a simple, approachable snack that feels fruity, portable, and easy to enjoy on repeat.",
    specifications:
      "Format: Ready-to-eat fruit chips. Texture: Crisp and snackable. Best for: Family snack jars, tea-time bites, road trips.",
    details:
      "Pair with nut butter, granola, or trail mix for a fuller snack plate with texture and natural sweetness.",
    price: 229,
    stockQuantity: 140,
    imagePaths: ["Banana-Pie-chips-Mockup-1.png", "Banana-Pie-chips-Mockup-2.png"],
  },
  {
    name: "Chikoo Pie Chips",
    categoryName: "Fruit Chips",
    subName: "A rich chikoo-inspired crunch with warm dessert-like notes.",
    description:
      "PIE Chikoo Pie Chips are built for people who enjoy a deeper, rounded fruit profile. The flavor feels slightly more indulgent than classic chips, which makes it a strong choice for premium gifting, curated snack platters, and moments when you want something a little different.",
    specifications:
      "Format: Ready-to-eat fruit chips. Texture: Crisp with a rich fruit profile. Best for: Premium snacking, gifting, party platters.",
    details:
      "Enjoy alongside coffee, masala chai, or as a crunchy topper over vanilla yogurt and dessert bowls.",
    price: 259,
    stockQuantity: 90,
    imagePaths: ["chikoo-Pie-chips-Mockup-1.png", "chikoo-Pie-chips-Mockup-2.png"],
  },
  {
    name: "Jackfruit Pie Chips",
    categoryName: "Fruit Chips",
    subName: "Bold tropical crunch with a fuller fruit character.",
    description:
      "PIE Jackfruit Pie Chips lean into a bolder tropical profile and are perfect for shoppers looking beyond standard snack flavors. They feel vibrant, memorable, and conversation-starting while still staying rooted in a familiar crunchy format.",
    specifications:
      "Format: Ready-to-eat fruit chips. Texture: Crisp and tropical. Best for: Novelty snacking, gourmet hampers, sharing bowls.",
    details:
      "Use as a tropical topping over smoothie bowls or snack on them as-is when you want something more distinctive.",
    price: 269,
    stockQuantity: 80,
    imagePaths: ["Jack-fruit-Pie-chips-Mockup-1.png", "Jack-fruit-Pie-chips-Mockup-2.png"],
  },
  {
    name: "Jamun Pie Chips",
    categoryName: "Fruit Chips",
    subName: "Dark fruit personality with a crisp, modern snack finish.",
    description:
      "PIE Jamun Pie Chips stand out with a characterful fruit profile that feels premium and less ordinary than typical packaged snacks. They are a strong option for a curated catalog because they add visual variety and a distinct flavor identity to the lineup.",
    specifications:
      "Format: Ready-to-eat fruit chips. Texture: Crisp and premium. Best for: Signature snack boxes, curated collections, festive gifting.",
    details:
      "Pair with cheese boards, mocktails, or dessert platters for a stylish serving option with strong visual appeal.",
    price: 279,
    stockQuantity: 75,
    imagePaths: ["Jamun-Pie-chips-Mockup-1.png", "Jamun-Pie-chips-Mockup-2.png"],
  },
  {
    name: "Mango Pie Chips",
    categoryName: "Fruit Chips",
    subName: "Sunny mango crunch made for instant crowd appeal.",
    description:
      "PIE Mango Pie Chips are the easiest hero product in the lineup because the flavor is familiar, upbeat, and broadly loved. They work well as a featured catalog item, a gift-box inclusion, and a reliable first purchase for new customers.",
    specifications:
      "Format: Ready-to-eat fruit chips. Texture: Crisp and fruity. Best for: Bestseller placement, combo boxes, family snacking.",
    details:
      "Serve chilled for a refreshing twist or crush lightly over yogurt and ice cream to add texture and fruit notes.",
    price: 249,
    stockQuantity: 160,
    imagePaths: ["mango-Pie-chips-Mockup-1.png", "mango-Pie-chips-Mockup-2.png"],
  },
  {
    name: "Pineapple Pie Chips",
    categoryName: "Fruit Chips",
    subName: "Bright tropical crunch with a lively island-style profile.",
    description:
      "PIE Pineapple Pie Chips bring a fresh, upbeat feeling to the range and help the catalog look more colorful and summery. The profile is ideal for shoppers who want a tropical note in a crisp, grab-and-go snack format.",
    specifications:
      "Format: Ready-to-eat fruit chips. Texture: Crisp and zesty. Best for: Summer gifting, travel packs, everyday snacking.",
    details:
      "Try them with sparkling drinks, fruit bowls, or as a crunchy garnish on chilled desserts and parfaits.",
    price: 239,
    stockQuantity: 110,
    imagePaths: ["pineapple-Pie-chips-Mockup-1.png", "pineapple-Pie-chips-Mockup-2.png"],
  },
  {
    name: "Strawberry Pie Chips",
    categoryName: "Fruit Chips",
    subName: "Berry-bright crunch that feels playful and premium at once.",
    description:
      "PIE Strawberry Pie Chips add a more playful berry note to the catalog while still looking premium and polished. They are a natural fit for gift boxes, combo packs, and customers drawn to a softer fruit aesthetic.",
    specifications:
      "Format: Ready-to-eat fruit chips. Texture: Light and berry-forward. Best for: Gift hampers, dessert pairings, premium snack curation.",
    details:
      "Use over pancakes, cereal, smoothie bowls, or enjoy directly from the pack when you want a fruit-led crunch.",
    price: 279,
    stockQuantity: 95,
    imagePaths: ["Strawberry-Pie-chips-Mockup-1.png", "Strawberry-Pie-chips-Mockup-2.png"],
  },
  {
    name: "Monk Fruit Sweetener",
    categoryName: "Natural Sweeteners",
    subName: "Clean everyday sweetness for beverages, desserts, and mindful recipes.",
    description:
      "PIE Monk Fruit Sweetener is positioned as a clean, modern pantry staple for people who want everyday sweetness without relying on conventional sugar-heavy habits. It fits coffee, tea, shakes, desserts, and home recipes where a smarter sweetening option matters.",
    specifications:
      "Format: Pantry sweetener. Usage: Drinks, desserts, daily cooking. Best for: Coffee, tea, smoothies, low-sugar recipes.",
    details:
      "Use in tea, coffee, lemonade, yogurt, baking mixes, and light dessert recipes whenever you want a cleaner sweetening option.",
    price: 349,
    stockQuantity: 130,
    imagePaths: [
      "PIE-Monk-Fruit-Pouch-Mockup1.png",
      "PIE-Monk-Fruit-Pouch-Mockup-2.png",
      "Pie-monk-fruit-Sachet-mockup-1.png",
    ],
  },
];

function ensureString(value: unknown): string {
  return String(value || "").trim();
}

async function loadManifest(): Promise<Map<string, string>> {
  const raw = await readFile(MANIFEST_PATH, "utf8");
  const entries = JSON.parse(raw) as ManifestEntry[];
  return new Map(entries.map((entry) => [entry.assetPath, entry.publicUrl]));
}

function getRequiredImageUrl(manifest: Map<string, string>, assetPath: string): string {
  const url = manifest.get(assetPath);
  if (!url) {
    throw new Error(`Missing uploaded asset URL for ${assetPath}`);
  }
  return url;
}

async function upsertCategory(
  connection: any,
  manifest: Map<string, string>,
  category: CategorySeed
): Promise<number> {
  const imageUrl = getRequiredImageUrl(manifest, category.imagePath);

  const [existingRows]: any = await connection.query(
    `SELECT category_id
     FROM categories
     WHERE LOWER(name) = LOWER(?)
     LIMIT 1`,
    [category.name]
  );

  if (existingRows.length) {
    const categoryId = Number(existingRows[0].category_id);
    await connection.query(
      `UPDATE categories
       SET description = ?, image_url = ?
       WHERE category_id = ?`,
      [category.description, imageUrl, categoryId]
    );
    return categoryId;
  }

  const [result]: any = await connection.query(
    `INSERT INTO categories (name, description, image_url)
     VALUES (?, ?, ?)`,
    [category.name, category.description, imageUrl]
  );

  return Number(result.insertId);
}

async function upsertProduct(
  connection: any,
  manifest: Map<string, string>,
  categoryIdsByName: Map<string, number>,
  product: ProductSeed
): Promise<void> {
  const categoryId = categoryIdsByName.get(product.categoryName);
  if (!categoryId) {
    throw new Error(`Category not found for product ${product.name}`);
  }

  const imageUrl = getRequiredImageUrl(manifest, product.imagePaths[0]);
  const imageUrl1 = product.imagePaths[1]
    ? getRequiredImageUrl(manifest, product.imagePaths[1])
    : null;
  const imageUrl2 = product.imagePaths[2]
    ? getRequiredImageUrl(manifest, product.imagePaths[2])
    : null;

  const values = [
    product.subName,
    product.description,
    product.price,
    product.stockQuantity,
    imageUrl,
    categoryId,
    product.specifications,
    product.details,
    imageUrl1,
    imageUrl2,
  ];

  const [existingRows]: any = await connection.query(
    `SELECT product_id
     FROM products
     WHERE LOWER(name) = LOWER(?)
     LIMIT 1`,
    [product.name]
  );

  if (existingRows.length) {
    await connection.query(
      `UPDATE products
       SET sub_name = ?, description = ?, price = ?, stock_quantity = ?, image_url = ?,
           category_id = ?, specifications = ?, details = ?, image_url1 = ?, image_url2 = ?
       WHERE product_id = ?`,
      [...values, Number(existingRows[0].product_id)]
    );
    return;
  }

  const [insertResult]: any = await connection.query(
    `INSERT INTO products
      (name, sub_name, description, price, stock_quantity, image_url, category_id, specifications, details, image_url1, image_url2)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [product.name, ...values]
  );

  const productId = Number(insertResult.insertId);
  await connection.query(
    `INSERT IGNORE INTO product_categories (product_id, category_id)
     VALUES (?, ?)`,
    [productId, categoryId]
  );
}

async function main(): Promise<void> {
  const manifest = await loadManifest();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const categoryIdsByName = new Map<string, number>();

    for (const category of CATEGORY_SEEDS) {
      const categoryId = await upsertCategory(connection, manifest, category);
      categoryIdsByName.set(category.name, categoryId);
    }

    for (const product of PRODUCT_SEEDS) {
      await upsertProduct(connection, manifest, categoryIdsByName, product);
    }

    await connection.commit();

    const [counts]: any = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM categories) AS category_count,
         (SELECT COUNT(*) FROM products) AS product_count`
    );

    console.log(
      `Catalog seed complete. Categories: ${ensureString(
        counts?.[0]?.category_count
      )}, products: ${ensureString(counts?.[0]?.product_count)}`
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await db.end();
  }
}

void main().catch((error) => {
  console.error("Catalog seed failed:", error);
  process.exitCode = 1;
});
