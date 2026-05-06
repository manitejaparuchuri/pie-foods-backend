import { Request, Response } from "express";
import { AuthRequest } from "../middlewares/auth";
import {
  addReviewService,
  getProductReviewsService,
  updateReviewService,
  deleteReviewService,
} from "../services/review.service";

const parseRating = (value: unknown): number | null => {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return null;
  }
  return rating;
};

const parseId = (value: unknown): string | null => {
  const id = String(value || "").trim();
  return id || null;
};

export const addReview = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const productId = parseId(req.body?.product_id ?? req.body?.productId);
    const rating = parseRating(req.body?.rating);
    const comment = String(req.body?.comment || "").trim();

    if (!productId || !rating || !comment) {
      return res.status(400).json({
        message: "Valid product_id, rating (1-5), and comment are required",
      });
    }

    const reviewId = await addReviewService(uid, productId, rating, comment);
    res.status(201).json({ message: "Review added", review_id: reviewId });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

export const getProductReviews = async (req: Request, res: Response) => {
  try {
    const productId = parseId(req.params.productId);
    if (!productId) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const reviews = await getProductReviewsService(productId);
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch reviews" });
  }
};

export const updateReview = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const reviewId = parseId(req.params.reviewId);
    const rating = parseRating(req.body?.rating);
    const comment = String(req.body?.comment || "").trim();

    if (!reviewId || !rating || !comment) {
      return res.status(400).json({
        message: "Valid reviewId, rating (1-5), and comment are required",
      });
    }

    await updateReviewService(uid, reviewId, rating, comment);
    res.json({ message: "Review updated" });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

export const deleteReview = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });

    const reviewId = parseId(req.params.reviewId);
    if (!reviewId) return res.status(400).json({ message: "Invalid review id" });

    await deleteReviewService(uid, reviewId);
    res.json({ message: "Review deleted" });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};
