import { Router } from "express";

import { getActiveBanners } from "../controller/banner.controller";

const router = Router();

router.get("/", getActiveBanners);

export default router;
