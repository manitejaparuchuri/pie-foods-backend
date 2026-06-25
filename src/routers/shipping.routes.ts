import { Router } from "express";
import {
  addShippingAddress,
  getShippingByUser,
  updateShippingAddress,
  deleteShippingAddress,
  setDefaultAddress
} from "../controller/shipping.controller";
import { verifyToken } from "../middlewares/auth";

const router = Router();

router.post("/", verifyToken, addShippingAddress);
router.get("/my", verifyToken, getShippingByUser);
// Literal/2-segment routes before the bare "/:id" param route.
router.put("/:id/default", verifyToken, setDefaultAddress);
router.put("/:id", verifyToken, updateShippingAddress);
router.delete("/:id", verifyToken, deleteShippingAddress);

export default router;
