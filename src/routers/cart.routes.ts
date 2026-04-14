import express from "express";
import {
  getAllCartItems,
  getCartItemById,
  addCartItem,
  updateCartItem,
  deleteCartItem,
  getcartByUserId,
  getcartByUserIdFromToken,
} from "../controller/cart.controller";
import { verifyToken } from "../middlewares/auth";

const router = express.Router();

// 🔥 user-specific routes FIRST
router.get("/user/me", verifyToken, getcartByUserIdFromToken);
router.get("/user/:user_Id", verifyToken, getcartByUserId);

// 🔐 protected routes
router.get("/", verifyToken, getAllCartItems);
router.post("/", verifyToken, addCartItem);
router.put("/:id", verifyToken, updateCartItem);
router.delete("/:id", verifyToken, deleteCartItem);
router.delete("/:user_id/:product_id", verifyToken, deleteCartItem);

// public (if really needed)
router.get("/:id", verifyToken, getCartItemById);


export default router;
