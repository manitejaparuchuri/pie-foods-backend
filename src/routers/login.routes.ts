import express from "express";
import { googleLogin, login } from "../controller/login.controller";
import { register } from "../controller/register.controller";
const router = express.Router();

router.post("/login", login);
router.post("/register", register);
router.post("/google", googleLogin);


export default router;
