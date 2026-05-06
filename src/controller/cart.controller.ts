import { Response } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { AuthRequest } from "../middlewares/auth";
import { fetchProductsByIds } from "../services/product-lookup.service";

const usersCollection = firestore.collection("users");

const cartCollection = (uid: string) =>
  usersCollection.doc(uid).collection("cart");

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

async function getCartRowsForUser(uid: string) {
  const snap = await cartCollection(uid).get();
  if (snap.empty) return [];

  const productIds = snap.docs
    .map((doc) => Number(doc.id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const productMap = await fetchProductsByIds(productIds);

  const rows = snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const productId = Number(doc.id);
    const product = productMap.get(productId);
    const addedAt = data.added_at as Timestamp | undefined;
    return {
      cart_item_id: doc.id,
      user_id: uid,
      product_id: productId,
      quantity: Number(data.quantity) || 0,
      added_at: addedAt ? addedAt.toDate().toISOString() : null,
      added_at_ms: addedAt ? addedAt.toDate().getTime() : 0,
      name: product?.name || "",
      price: product?.price || 0,
      image_url: product?.image_url || null,
    };
  });

  rows.sort((a, b) => b.added_at_ms - a.added_at_ms);
  return rows.map(({ added_at_ms: _ms, ...rest }) => rest);
}

export const getAllCartItems = async (req: AuthRequest, res: Response) => {
  const uid = req.user?.uid;
  if (!uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const rows = await getCartRowsForUser(uid);
    return res.json(rows);
  } catch (error) {
    console.error("GET ALL CART ITEMS ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getcartByUserIdFromToken = async (req: AuthRequest, res: Response) => {
  const uid = req.user?.uid;
  if (!uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const rows = await getCartRowsForUser(uid);
    return res.json(rows);
  } catch (error) {
    console.error("GET CART BY TOKEN USER ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getcartByUserId = async (req: AuthRequest, res: Response) => {
  const targetUid = String(req.params.user_Id || "").trim();
  if (!targetUid) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (authUser.role !== "admin" && authUser.uid !== targetUid) {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    const rows = await getCartRowsForUser(targetUid);
    return res.json(rows);
  } catch (error) {
    console.error("GET CART BY USER ID ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getCartItemById = async (req: AuthRequest, res: Response) => {
  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const cartItemId = String(req.params.id || "").trim();
  if (!cartItemId) {
    return res.status(400).json({ message: "Invalid cart item id" });
  }

  try {
    const doc = await cartCollection(authUser.uid).doc(cartItemId).get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Cart item not found" });
    }
    const data = doc.data() as Record<string, unknown>;
    const productId = Number(doc.id);
    const productMap = await fetchProductsByIds([productId]);
    const product = productMap.get(productId);
    const addedAt = data.added_at as Timestamp | undefined;

    return res.json({
      cart_item_id: doc.id,
      user_id: authUser.uid,
      product_id: productId,
      quantity: Number(data.quantity) || 0,
      added_at: addedAt ? addedAt.toDate().toISOString() : null,
      name: product?.name || "",
      price: product?.price || 0,
      image_url: product?.image_url || null,
    });
  } catch (error) {
    console.error("GET CART ITEM BY ID ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const addCartItem = async (req: AuthRequest, res: Response) => {
  const uid = req.user?.uid;
  if (!uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const productId = parsePositiveInt(req.body?.productId ?? req.body?.product_id);
  const quantity = parsePositiveInt(req.body?.quantity ?? 1);

  if (!productId || !quantity) {
    return res.status(400).json({ message: "productId and quantity are required" });
  }

  try {
    const productMap = await fetchProductsByIds([productId]);
    const product = productMap.get(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const cartItemRef = cartCollection(uid).doc(String(productId));
    const existing = await cartItemRef.get();
    const previousQuantity = existing.exists
      ? Number((existing.data() as Record<string, unknown>).quantity) || 0
      : 0;
    const newQuantity = previousQuantity + quantity;

    await cartItemRef.set(
      {
        product_id: productId,
        quantity: newQuantity,
        added_at: existing.exists
          ? (existing.data() as Record<string, unknown>).added_at || Timestamp.now()
          : Timestamp.now(),
        updated_at: Timestamp.now(),
      },
      { merge: true }
    );

    return res.status(existing.exists ? 200 : 201).json({
      message: existing.exists ? "Cart item updated" : "Cart item added",
      cart_item_id: cartItemRef.id,
      quantity: newQuantity,
    });
  } catch (error) {
    console.error("ADD CART ITEM ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateCartItem = async (req: AuthRequest, res: Response) => {
  const uid = req.user?.uid;
  if (!uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const cartItemId = String(req.params.id || "").trim();
  const quantity = parsePositiveInt(req.body?.quantity);

  if (!cartItemId || !quantity) {
    return res.status(400).json({ message: "Valid cart item id and quantity are required" });
  }

  try {
    const ref = cartCollection(uid).doc(cartItemId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    await ref.update({ quantity, updated_at: Timestamp.now() });

    return res.json({
      message: "Cart item updated",
      cart_item_id: cartItemId,
      quantity,
    });
  } catch (error) {
    console.error("UPDATE CART ITEM ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const deleteCartItem = async (req: AuthRequest, res: Response) => {
  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const cartItemId = String(req.params.id ?? req.params.cart_item_id ?? "").trim();
  const userIdParam = String(req.params.user_id || "").trim();
  const productIdParam = String(req.params.product_id || "").trim();

  try {
    if (cartItemId) {
      const ref = cartCollection(authUser.uid).doc(cartItemId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ message: "Cart item not found" });
      }
      await ref.delete();
      return res.json({ message: "Cart item removed" });
    }

    if (!userIdParam || !productIdParam) {
      return res.status(400).json({ message: "Invalid delete parameters" });
    }

    if (authUser.role !== "admin" && authUser.uid !== userIdParam) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const ref = cartCollection(userIdParam).doc(productIdParam);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ message: "Cart item not found" });
    }
    await ref.delete();
    return res.json({ message: "Cart item removed" });
  } catch (error) {
    console.error("DELETE CART ITEM ERROR:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export async function clearUserCart(uid: string): Promise<void> {
  const snap = await cartCollection(uid).get();
  if (snap.empty) return;
  const batch = firestore.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}
