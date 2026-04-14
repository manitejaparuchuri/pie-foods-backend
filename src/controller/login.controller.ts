import { Request, Response } from "express";
import db from "../config/db";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";

interface SafeUser {
  user_id: number;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  role: string;
}

const googleClient = new OAuth2Client();

function getAllowedGoogleClientIds(): string[] {
  const fromEnv = (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return fromEnv;
}

const toSafeUser = (user: any): SafeUser => ({
  user_id: Number(user.user_id),
  name: String(user.name || ""),
  email: String(user.email || ""),
  phone: user.phone ?? null,
  address: user.address ?? null,
  role: String(user.role || "customer"),
});

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const [rows]: any = await db.query(
      `SELECT user_id, name, email, phone, address, role, password_hash
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [normalizedEmail]
    );

    if (!rows.length) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = rows[0];

    
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        id: user.user_id,
        role: user.role
      },
      process.env.JWT_SECRET!,
      { expiresIn: "1d" }
    );

    return res.json({ message: "Login Successful", token, user: toSafeUser(user) });

  } catch (error: any) {
    console.error("LOGIN ERROR:", error?.message || error);
    return res.status(500).json({ message: "Server Error" });
  }
};

export const googleLogin = async (req: Request, res: Response) => {
  const { token } = req.body;
  const allowedClientIds = getAllowedGoogleClientIds();

  if (!token) {
    return res.status(400).json({ message: "Google token is required" });
  }

  if (!allowedClientIds.length) {
    console.error("GOOGLE_CLIENT_IDS is not configured");
    return res.status(500).json({ message: "Google login is not configured" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: allowedClientIds
    });

    const payload = ticket.getPayload();
    const email = payload?.email?.trim().toLowerCase();
    const name = payload?.name?.trim() || "Google User";

    if (!email) {
      return res.status(400).json({ message: "Unable to read Google account email" });
    }

    const [existingRows]: any = await db.query(
      `SELECT user_id, name, email, phone, address, role
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    let user = existingRows[0];

    if (!user) {
      const randomPassword = crypto.randomBytes(24).toString("hex");
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      const [insertResult]: any = await db.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES (?, ?, ?, 'customer')`,
        [name, email, passwordHash]
      );

      const [createdRows]: any = await db.query(
        `SELECT user_id, name, email, phone, address, role
         FROM users
         WHERE user_id = ?
         LIMIT 1`,
        [insertResult.insertId]
      );
      user = createdRows[0];
    }

    const jwtToken = jwt.sign(
      {
        id: user.user_id,
        role: user.role || "customer"
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "1d" }
    );

    return res.json({
      message: "Google login successful",
      token: jwtToken,
      user: toSafeUser(user)
    });
  } catch (error: any) {
    console.error("GOOGLE LOGIN ERROR:", error?.message || error);
    return res.status(401).json({ message: "Google authentication failed" });
  }
};
