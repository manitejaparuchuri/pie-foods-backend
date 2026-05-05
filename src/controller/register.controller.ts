import { Request, Response } from "express";
import db from "../config/db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { useFirebaseAuth } from "../config/auth-provider";
import { isAuthFlowError, registerWithFirebaseAuth } from "../services/firebase-auth.service";

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone, address } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!name || !normalizedEmail || !password) {
      return res.status(400).json({ message: "name, email, password are required" });
    }

    if (useFirebaseAuth()) {
      const user = await registerWithFirebaseAuth({
        name: String(name || "").trim(),
        email: normalizedEmail,
        password: String(password || ""),
        phone: phone || null,
        address: address || null,
      });

      const token = jwt.sign(
        { id: user.user_id, role: user.role },
        process.env.JWT_SECRET as string,
        { expiresIn: "1d" }
      );

      return res.status(201).json({
        message: "Registration successful",
        user,
        token
      });
    }

    const [existing]: any = await db.query("SELECT user_id FROM users WHERE email = ?", [normalizedEmail]);
    if (existing.length) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const [result]: any = await db.query(
      `INSERT INTO users (name, email, password_hash, phone, address, role)
       VALUES (?, ?, ?, ?, ?, 'customer')`,
      [name, normalizedEmail, password_hash, phone || null, address || null]
    );

    const token = jwt.sign(
      { id: result.insertId, role: "customer" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1d" }
    );

    return res.status(201).json({
      message: "Registration successful",
      user: { user_id: result.insertId, name, email: normalizedEmail, phone, address, role: "customer" },
      token
    });
  } catch (err: any) {
    if (isAuthFlowError(err)) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    if (err?.message === "Email already registered" || err?.code === "auth/email-already-exists") {
      return res.status(409).json({ message: "Email already registered" });
    }
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Email already registered" });
    }
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};
