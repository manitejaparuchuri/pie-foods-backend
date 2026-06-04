import express from "express";
import { getMe, googleLogin, login, updateMe } from "../controller/login.controller";
import { register } from "../controller/register.controller";
import { verifyToken } from "../middlewares/auth";

const router = express.Router();

router.post("/login", login);
router.post("/register", register);
router.post("/google", googleLogin);

// Authenticated profile read/update for the signed-in user.
router.get("/me", verifyToken, getMe);
router.put("/me", verifyToken, updateMe);

export default router;
