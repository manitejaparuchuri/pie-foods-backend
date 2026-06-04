import { Router } from "express";

import { getStorefrontSettings } from "../controller/storefront.controller";

const router = Router();

router.get("/settings", getStorefrontSettings);

export default router;
