import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";

const reviewsCollection = firestore.collection("reviews");
const usersCollection = firestore.collection("users");

export interface ReviewRecord {
  review_id: string;
  user_id: string;
  user_name: string;
  product_id: string;
  rating: number;
  comment: string;
  review_date: string;
}

async function getUserDisplayName(uid: string): Promise<string> {
  const snap = await usersCollection.doc(uid).get();
  const data = snap.exists ? (snap.data() as Record<string, unknown>) : null;
  return String(data?.name || "Customer").trim() || "Customer";
}

export const addReviewService = async (
  uid: string,
  productId: string,
  rating: number,
  comment: string
): Promise<string> => {
  const existing = await reviewsCollection
    .where("user_id", "==", uid)
    .where("product_id", "==", productId)
    .limit(1)
    .get();

  if (!existing.empty) {
    throw new Error("You already reviewed this product");
  }

  const userName = await getUserDisplayName(uid);
  const ref = reviewsCollection.doc();
  await ref.set({
    user_id: uid,
    user_name: userName,
    product_id: productId,
    rating,
    comment,
    review_date: Timestamp.now(),
  });

  return ref.id;
};

export const getProductReviewsService = async (
  productId: string
): Promise<ReviewRecord[]> => {
  const snap = await reviewsCollection
    .where("product_id", "==", productId)
    .get();

  const rows = snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const reviewDate = data.review_date as Timestamp | undefined;
    return {
      review_id: doc.id,
      user_id: String(data.user_id || ""),
      user_name: String(data.user_name || "Customer"),
      product_id: String(data.product_id || ""),
      rating: Number(data.rating) || 0,
      comment: String(data.comment || ""),
      review_date: reviewDate ? reviewDate.toDate().toISOString() : "",
      review_date_ms: reviewDate ? reviewDate.toDate().getTime() : 0,
    };
  });

  rows.sort((a, b) => b.review_date_ms - a.review_date_ms);
  return rows.map(({ review_date_ms: _ms, ...rest }) => rest);
};

export const updateReviewService = async (
  uid: string,
  reviewId: string,
  rating: number,
  comment: string
): Promise<void> => {
  const ref = reviewsCollection.doc(reviewId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Review not found or unauthorized");
  }
  const data = snap.data() as Record<string, unknown>;
  if (String(data.user_id || "") !== uid) {
    throw new Error("Review not found or unauthorized");
  }

  await ref.update({
    rating,
    comment,
    updated_at: Timestamp.now(),
  });
};

export const deleteReviewService = async (
  uid: string,
  reviewId: string
): Promise<void> => {
  const ref = reviewsCollection.doc(reviewId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Review not found or unauthorized");
  }
  const data = snap.data() as Record<string, unknown>;
  if (String(data.user_id || "") !== uid) {
    throw new Error("Review not found or unauthorized");
  }

  await ref.delete();
};
