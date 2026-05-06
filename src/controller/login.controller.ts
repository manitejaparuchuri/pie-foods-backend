import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import {
  isAuthFlowError,
  loginWithFirebaseAuth,
  upsertFirestoreUserFromGoogleLogin,
} from "../services/firebase-auth.service";

const googleClient = new OAuth2Client();

function getAllowedGoogleClientIds(): string[] {
  const fromEnv = (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return fromEnv;
}

function signSessionToken(uid: string, role: string, email: string): string {
  return jwt.sign(
    { uid, role, email },
    process.env.JWT_SECRET as string,
    { expiresIn: "1d" }
  );
}

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const user = await loginWithFirebaseAuth(normalizedEmail, String(password || ""));
    const token = signSessionToken(user.uid, user.role, user.email);
    return res.json({ message: "Login Successful", token, user });
  } catch (error: any) {
    if (isAuthFlowError(error)) {
      console.error("LOGIN ERROR:", error.errorCode || error.message);
      return res.status(error.statusCode).json({ message: error.message });
    }

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

    const user = await upsertFirestoreUserFromGoogleLogin({ email, name });
    const jwtToken = signSessionToken(user.uid, user.role, user.email);

    return res.json({
      message: "Google login successful",
      token: jwtToken,
      user,
    });
  } catch (error: any) {
    console.error("GOOGLE LOGIN ERROR:", error?.message || error);
    return res.status(401).json({ message: "Google authentication failed" });
  }
};
