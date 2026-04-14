import { Router } from "express";
import {
  addShippingAddress,
  getShippingByUser
} from "../controller/shipping.controller";
import { verifyToken } from "../middlewares/auth"; 

const router = Router();

router.post("/", verifyToken, addShippingAddress);
router.get("/my", verifyToken, getShippingByUser);

export default router;
