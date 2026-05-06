import { getEnvValue } from "./env";

export type CatalogDataSource = "mysql" | "firestore";

export function getCatalogDataSource(): CatalogDataSource {
  const source = getEnvValue("CATALOG_DATA_SOURCE").toLowerCase();
  return source === "firestore" ? "firestore" : "mysql";
}

export function useFirestoreCatalog(): boolean {
  return getCatalogDataSource() === "firestore";
}

export function getFirestoreCategoriesCollectionName(): string {
  return getEnvValue("FIREBASE_CATEGORIES_COLLECTION") || "categories";
}

export function getFirestoreProductsCollectionName(): string {
  return getEnvValue("FIREBASE_PRODUCTS_COLLECTION") || "products";
}

export function getFirestoreCombosCollectionName(): string {
  return getEnvValue("FIREBASE_COMBOS_COLLECTION") || "combos";
}

export function getFirestoreBannersCollectionName(): string {
  return getEnvValue("FIREBASE_BANNERS_COLLECTION") || "banners";
}

export function getFirestorePopularProductsCollectionName(): string {
  return getEnvValue("FIREBASE_POPULAR_PRODUCTS_COLLECTION") || "popular_products";
}
