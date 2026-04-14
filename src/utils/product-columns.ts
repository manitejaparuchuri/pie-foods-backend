import db from "../config/db";

const REQUIRED_PRODUCT_COLUMNS = [
  "product_id",
  "name",
  "sub_name",
  "description",
  "price",
  "stock_quantity",
  "category_id",
  "image_url",
  "created_at",
] as const;

const OPTIONAL_PRODUCT_COLUMNS = [
  "specifications",
  "counter_details",
  "warranty_installation",
  "details",
  "is_active",
  "image_url1",
  "image_url2",
  "image_url3",
  "image_url4",
  "image_url5",
  "image_url6",
  "image_url7",
  "image_url8",
  "image_url9",
  "image_url10",
] as const;

type ProductColumn = (typeof REQUIRED_PRODUCT_COLUMNS)[number] | (typeof OPTIONAL_PRODUCT_COLUMNS)[number];

let productColumnsPromise: Promise<Set<string>> | null = null;

async function loadProductColumns(): Promise<Set<string>> {
  const [rows]: any = await db.query("SHOW COLUMNS FROM products");
  return new Set(rows.map((row: any) => String(row.Field)));
}

export async function getProductColumns(): Promise<Set<string>> {
  if (!productColumnsPromise) {
    productColumnsPromise = loadProductColumns().catch((error) => {
      productColumnsPromise = null;
      throw error;
    });
  }

  return productColumnsPromise;
}

export async function getAvailableOptionalProductColumns(): Promise<ProductColumn[]> {
  const columns = await getProductColumns();
  return OPTIONAL_PRODUCT_COLUMNS.filter((column) => columns.has(column));
}

export async function getSelectableProductColumns(alias?: string): Promise<string[]> {
  const prefix = alias ? `${alias}.` : "";
  const availableOptionalColumns = await getAvailableOptionalProductColumns();
  return [
    ...REQUIRED_PRODUCT_COLUMNS.map((column) => `${prefix}${column}`),
    ...availableOptionalColumns.map((column) => `${prefix}${column}`),
  ];
}

export async function getWritableProductColumns(): Promise<readonly string[]> {
  const availableOptionalColumns = await getAvailableOptionalProductColumns();
  return [
    "name",
    "sub_name",
    "description",
    "price",
    "stock_quantity",
    "category_id",
    "image_url",
    ...availableOptionalColumns,
  ];
}

export async function getUpdatableProductTextColumns(): Promise<string[]> {
  const availableOptionalColumns = await getAvailableOptionalProductColumns();
  return [
    "name",
    "sub_name",
    "description",
    "image_url",
    ...availableOptionalColumns.filter((column) => column !== "is_active"),
  ];
}

export async function getAvailableProductImageFields(): Promise<string[]> {
  const availableOptionalColumns = await getAvailableOptionalProductColumns();
  return [
    "image_url",
    ...availableOptionalColumns.filter((column) => column.startsWith("image_url")),
  ];
}

export function clearProductColumnsCache(): void {
  productColumnsPromise = null;
}
