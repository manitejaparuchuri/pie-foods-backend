import { Router } from "express";

import { getPopularProductShowcase } from "../controller/popular-products.controller";

const router = Router();

router.get("/", getPopularProductShowcase);

export default router;
