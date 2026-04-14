import { Request, Response } from "express";
import {
  addReviewService,
  getProductReviewsService,
  updateReviewService,
  deleteReviewService
} from "../services/review.service";

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const parseRating = (value: unknown): number | null => {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return null;
  }
  return rating;
};

export const addReview = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const productId = parsePositiveInt(req.body?.product_id);
    const rating = parseRating(req.body?.rating);
    const comment = String(req.body?.comment || "").trim();

    if (!productId || !rating || !comment) {
      return res.status(400).json({ message: "Valid product_id, rating (1-5), and comment are required" });
    }

    const reviewId = await addReviewService(
      userId,
      productId,
      rating,
      comment
    );

    res.status(201).json({
      message: "Review added",
      review_id: reviewId
    });

  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};


export const getProductReviews = async (req: Request, res: Response) => {
  try {
    const productId = parsePositiveInt(req.params.productId);
    if (!productId) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const reviews = await getProductReviewsService(productId);

    res.json(reviews);

  } catch (error) {
    res.status(500).json({ message: "Failed to fetch reviews" });
  }
};


export const updateReview = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const reviewId = parsePositiveInt(req.params.reviewId);
    const rating = parseRating(req.body?.rating);
    const comment = String(req.body?.comment || "").trim();

    if (!reviewId || !rating || !comment) {
      return res.status(400).json({ message: "Valid reviewId, rating (1-5), and comment are required" });
    }

    await updateReviewService(userId, reviewId, rating, comment);

    res.json({ message: "Review updated" });

  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};


export const deleteReview = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const reviewId = parsePositiveInt(req.params.reviewId);

    if (!reviewId) {
      return res.status(400).json({ message: "Invalid review id" });
    }

    await deleteReviewService(userId, reviewId);

    res.json({ message: "Review deleted" });

  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};
