import express from "express";
import { checkout } from "../controller/checkout.controller";
import { verifyToken } from "../middlewares/auth";

const router = express.Router();

router.post("/", verifyToken, checkout);

export default router;
