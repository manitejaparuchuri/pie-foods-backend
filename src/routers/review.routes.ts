import { Router } from "express";
import {
  addReview,
  getProductReviews,
  updateReview,
  deleteReview
} from "../controller/review.controller";
import { verifyToken } from "../middlewares/auth";

const router = Router();

// Add review
router.post("/", verifyToken, addReview);

// Get reviews for a product
router.get("/product/:productId", getProductReviews);

// Update review
router.put("/:reviewId", verifyToken, updateReview);

// Delete review
router.delete("/:reviewId", verifyToken, deleteReview);

export default router;
