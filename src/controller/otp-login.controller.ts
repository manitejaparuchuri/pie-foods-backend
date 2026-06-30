import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";

import { firestore } from "../config/firebase";
import { getFirestoreUsersCollectionName } from "../config/auth-provider";
import {
  OtpInvalidError,
  OtpRateLimitError,
  requestOtp,
  verifyOtp,
} from "../services/otp.service";
import { linkGuestOrdersToUser } from "./guest-order.controller";
import { notifyCustomerWelcome } from "../services/order-notifications.service";

const usersCollection = firestore.collection(getFirestoreUsersCollectionName());
const fbAuth = getAuth();

/* ============================ POST /api/auth/otp/request ============================ */

export const requestOtpController = async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const result = await requestOtp(email);
    return res.json({
      message: "OTP sent to your email. It expires in 10 minutes.",
      expiresInSeconds: result.expiresInSeconds,
    });
  } catch (error: any) {
    if (error instanceof OtpInvalidError) {
      return res.status(400).json({ message: error.message });
    }
    if (error instanceof OtpRateLimitError) {
      return res.status(429).json({
        message: error.message,
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    console.error("REQUEST OTP ERROR:", error?.message || error);
    return res.status(500).json({
      message: String(error?.message || "Could not send OTP. Please try again."),
    });
  }
};

/* ============================ POST /api/auth/otp/verify ============================ */

export const verifyOtpController = async (req: Request, res: Response) => {
  try {
    const emailRaw = String(req.body?.email || "").trim().toLowerCase();
    const codeRaw = String(req.body?.code || "").trim();

    const { email } = await verifyOtp(emailRaw, codeRaw);

    // Find or create a Firebase user for this email
    let firebaseUser;
    let isNewUser = false;
    try {
      firebaseUser = await fbAuth.getUserByEmail(email);
    } catch {
      firebaseUser = await fbAuth.createUser({
        email,
        emailVerified: true, // OTP-verified
        displayName: email.split("@")[0],
      });
      isNewUser = true;
    }

    const uid = firebaseUser.uid;
    const now = Timestamp.now();

    // Upsert Firestore profile
    const profileSnap = await usersCollection.doc(uid).get();
    const existingProfile = profileSnap.exists
      ? (profileSnap.data() as Record<string, unknown>)
      : {};

    const baseProfile: Record<string, unknown> = {
      uid,
      email,
      name:
        String(existingProfile.name || "").trim() ||
        firebaseUser.displayName ||
        email.split("@")[0],
      phone: existingProfile.phone ?? null,
      address: existingProfile.address ?? null,
      role: String(existingProfile.role || "customer"),
      auth_provider: "otp",
      updated_at: now,
      last_login_at: now,
    };
    if (!profileSnap.exists) {
      baseProfile.created_at = now;
    }
    await usersCollection.doc(uid).set(baseProfile, { merge: true });

    // Link any past guest orders (best-effort, non-blocking on failure)
    let linkedCount = 0;
    try {
      linkedCount = await linkGuestOrdersToUser(email, uid);
    } catch (err) {
      console.error("Auto-link guest orders failed:", err);
    }

    // Welcome email — only fired the FIRST time we mint a user record for
    // this email. Returning customers signing in via OTP don't get spammed.
    if (isNewUser) {
      notifyCustomerWelcome(email, String(baseProfile.name)).catch((err) =>
        console.error("welcome notify (otp) failed:", err)
      );
    }

    // Mint the same JWT shape as the password login path
    const jwtSecret = process.env.JWT_SECRET as string;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not configured");
    }
    const token = jwt.sign(
      {
        uid,
        role: String(baseProfile.role),
        email,
      },
      jwtSecret,
      { expiresIn: "30d" }
    );

    return res.json({
      message: "Sign-in successful",
      token,
      user: {
        uid,
        email,
        name: String(baseProfile.name),
        role: String(baseProfile.role),
        phone: baseProfile.phone || null,
        address: baseProfile.address || null,
      },
      linkedOrders: linkedCount,
      // True only when this OTP verify just created the account — the storefront
      // uses it to fire the "welcome / 10% off" celebration popup once.
      isNewUser,
    });
  } catch (error: any) {
    if (error instanceof OtpInvalidError) {
      return res.status(400).json({ message: error.message });
    }
    console.error("VERIFY OTP ERROR:", error?.message || error);
    return res.status(500).json({
      message: "Could not complete sign-in. Please try again.",
    });
  }
};
