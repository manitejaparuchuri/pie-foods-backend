import { Router } from "express";

import { getActiveCombos } from "../controller/combo.controller";

const router = Router();

router.get("/", getActiveCombos);

export default router;
