import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { isAuthFlowError, registerWithFirebaseAuth } from "../services/firebase-auth.service";

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone, address } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!name || !normalizedEmail || !password) {
      return res.status(400).json({ message: "name, email, password are required" });
    }

    const user = await registerWithFirebaseAuth({
      name: String(name || "").trim(),
      email: normalizedEmail,
      password: String(password || ""),
      phone: phone || null,
      address: address || null,
    });

    const token = jwt.sign(
      { uid: user.uid, role: user.role, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "1d" }
    );

    return res.status(201).json({
      message: "Registration successful",
      user,
      token,
    });
  } catch (err: any) {
    if (isAuthFlowError(err)) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    if (err?.message === "Email already registered" || err?.code === "auth/email-already-exists") {
      return res.status(409).json({ message: "Email already registered" });
    }

    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};
