import { firestore } from "../config/firebase";
import { getFirestoreProductsCollectionName } from "../config/catalog";

const productsCollection = firestore.collection(getFirestoreProductsCollectionName());

export interface ProductSnapshot {
  product_id: number;
  name: string;
  price: number;
  image_url: string | null;
}

const FIRESTORE_IN_LIMIT = 30;

/**
 * Batch fetch products by their numeric product_id in O(ceil(N/30)) Firestore queries
 * instead of one query per product. Used by cart/checkout/order to avoid N+1 reads.
 */
export async function fetchProductsByIds(
  ids: number[]
): Promise<Map<number, ProductSnapshot>> {
  const map = new Map<number, ProductSnapshot>();
  const unique = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (unique.length === 0) return map;

  const chunks: number[][] = [];
  for (let i = 0; i < unique.length; i += FIRESTORE_IN_LIMIT) {
    chunks.push(unique.slice(i, i + FIRESTORE_IN_LIMIT));
  }

  const snapshots = await Promise.all(
    chunks.map((chunk) =>
      productsCollection.where("product_id", "in", chunk).get()
    )
  );

  for (const snap of snapshots) {
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const productId = Number(data.product_id);
      if (!Number.isFinite(productId) || productId <= 0) continue;
      map.set(productId, {
        product_id: productId,
        name: String(data.name || ""),
        price: Number(data.price) || 0,
        image_url: (data.image_url as string) || null,
      });
    }
  }

  return map;
}
