import { Response } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { generateShippingId } from "../utils/files";
import { AuthRequest } from "../middlewares/auth";

const usersCollection = firestore.collection("users");

const addressesCollection = (uid: string) =>
  usersCollection.doc(uid).collection("addresses");

export const addShippingAddress = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { address, city, state, postal_code, country, phone } = req.body;

    if (!address || !city || !state || !postal_code) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const shipping_id = generateShippingId();
    await addressesCollection(uid).doc(shipping_id).set({
      shipping_id,
      user_id: uid,
      address: String(address),
      city: String(city),
      state: String(state),
      postal_code: String(postal_code),
      country: String(country ?? "India"),
      phone: phone ? String(phone) : null,
      is_default: req.body?.is_default === true,
      created_at: Timestamp.now(),
    });

    return res.status(201).json({
      message: "Shipping address added",
      shipping_id,
    });
  } catch (err: any) {
    console.error("ADD SHIPPING ERROR:", err);
    return res.status(500).json({ error: "Failed to save shipping address" });
  }
};

export const getShippingByUser = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const snap = await addressesCollection(uid).get();
    const rows = snap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const createdAt = data.created_at as Timestamp | undefined;
      return {
        shipping_id: String(data.shipping_id || doc.id),
        user_id: String(data.user_id || uid),
        address: String(data.address || ""),
        city: String(data.city || ""),
        state: String(data.state || ""),
        postal_code: String(data.postal_code || ""),
        country: String(data.country || "India"),
        phone: data.phone ? String(data.phone) : null,
        is_default: data.is_default === true,
        created_at: createdAt ? createdAt.toDate().toISOString() : null,
      };
    });

    res.json(rows);
  } catch (error: any) {
    console.error("GET SHIPPING ERROR:", error);
    res.status(500).json({ error: "Failed to load shipping addresses" });
  }
};

export const updateShippingAddress = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Invalid address id" });

    const { address, city, state, postal_code, country, phone } = req.body;
    if (!address || !city || !state || !postal_code) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const ref = addressesCollection(uid).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Address not found" });

    await ref.update({
      address: String(address),
      city: String(city),
      state: String(state),
      postal_code: String(postal_code),
      country: String(country ?? "India"),
      phone: phone ? String(phone) : null,
      updated_at: Timestamp.now(),
    });

    return res.json({ message: "Address updated", shipping_id: id });
  } catch (err: any) {
    console.error("UPDATE SHIPPING ERROR:", err);
    return res.status(500).json({ error: "Failed to update address" });
  }
};

export const deleteShippingAddress = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Invalid address id" });

    const ref = addressesCollection(uid).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Address not found" });

    await ref.delete();
    return res.json({ message: "Address removed", shipping_id: id });
  } catch (err: any) {
    console.error("DELETE SHIPPING ERROR:", err);
    return res.status(500).json({ error: "Failed to remove address" });
  }
};

export const setDefaultAddress = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Invalid address id" });

    const ref = addressesCollection(uid).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Address not found" });

    // Flip is_default so exactly one address is the default.
    const all = await addressesCollection(uid).get();
    const batch = firestore.batch();
    all.docs.forEach((doc) => {
      batch.update(doc.ref, {
        is_default: doc.id === id,
        updated_at: Timestamp.now(),
      });
    });
    await batch.commit();

    return res.json({ message: "Default address set", shipping_id: id });
  } catch (err: any) {
    console.error("SET DEFAULT SHIPPING ERROR:", err);
    return res.status(500).json({ error: "Failed to set default address" });
  }
};
