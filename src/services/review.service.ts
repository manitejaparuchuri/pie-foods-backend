import pool from "../config/db";

export const addReviewService = async (
  userId: number,
  productId: number,
  rating: number,
  comment: string
) => {

  // ❌ Prevent duplicate review
  const [existing]: any = await pool.query(
    "SELECT review_id FROM reviews WHERE user_id=? AND product_id=?",
    [userId, productId]
  );

  if (existing.length) {
    throw new Error("You already reviewed this product");
  }

  const [result]: any = await pool.query(
    `INSERT INTO reviews
     (user_id, product_id, rating, comment)
     VALUES (?, ?, ?, ?)`,
    [userId, productId, rating, comment]
  );

  return result.insertId;
};


export const getProductReviewsService = async (productId: number) => {

  const [rows]: any = await pool.query(
    `SELECT r.review_id, r.user_id, r.rating, r.comment, r.review_date,
            u.name AS user_name
     FROM reviews r
     JOIN users u ON r.user_id = u.user_id
     WHERE r.product_id = ?
     ORDER BY r.review_date DESC`,
    [productId]
  );

  return rows;
};


export const updateReviewService = async (
  userId: number,
  reviewId: number,
  rating: number,
  comment: string
) => {

  const [result]: any = await pool.query(
    `UPDATE reviews
     SET rating=?, comment=?
     WHERE review_id=? AND user_id=?`,
    [rating, comment, reviewId, userId]
  );

  if (!result.affectedRows) {
    throw new Error("Review not found or unauthorized");
  }
};


export const deleteReviewService = async (
  userId: number,
  reviewId: number
) => {

  const [result]: any = await pool.query(
    `DELETE FROM reviews
     WHERE review_id=? AND user_id=?`,
    [reviewId, userId]
  );

  if (!result.affectedRows) {
    throw new Error("Review not found or unauthorized");
  }
};
