import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import {
  changeUserPassword,
  getUserProfile,
  isAuthFlowError,
  loginWithFirebaseAuth,
  updateUserProfile,
  upsertFirestoreUserFromGoogleLogin,
} from "../services/firebase-auth.service";
import {
  requestPasswordReset,
  resetPasswordWithToken,
} from "../services/password-reset.service";
import { AuthRequest } from "../middlewares/auth";

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

export const getMe = async (req: AuthRequest, res: Response) => {
  const uid = req.user?.uid;
  if (!uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const user = await getUserProfile(uid);
    if (!user) {
      return res.status(404).json({ message: "Profile not found" });
    }
    return res.json({ user });
  } catch (error: any) {
    console.error("GET ME ERROR:", error?.message || error);
    return res.status(500).json({ message: "Unable to load profile" });
  }
};

export const updateMe = async (req: AuthRequest, res: Response) => {
  const uid = req.user?.uid;
  if (!uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const body = req.body || {};
  // Only accept the three fields a customer can change themselves.
  const patch = {
    name: typeof body.name === "string" ? body.name : undefined,
    phone: typeof body.phone === "string" ? body.phone : undefined,
    address: typeof body.address === "string" ? body.address : undefined,
  };

  try {
    const user = await updateUserProfile(uid, patch);
    return res.json({ message: "Profile updated", user });
  } catch (error: any) {
    if (isAuthFlowError(error)) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("UPDATE ME ERROR:", error?.message || error);
    return res.status(500).json({ message: "Unable to update profile" });
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

// Always responds with the same generic message so the endpoint never reveals
// whether an account exists for the submitted email. The actual lookup + email
// send happens inside the service and is silently skipped when there's no
// password-based account.
const FORGOT_PASSWORD_MESSAGE =
  "If an account exists for that email, a reset link has been sent.";

export const forgotPassword = async (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();

  try {
    await requestPasswordReset(email);
  } catch (error: any) {
    // Never surface internal failures (or whether the email exists) to the
    // caller — just log and return the generic success response.
    console.error("FORGOT PASSWORD ERROR:", error?.message || error);
  }

  return res.json({ message: FORGOT_PASSWORD_MESSAGE });
};

export const resetPassword = async (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const token = String(req.body?.token || "");
  const password = String(req.body?.password || "");

  try {
    const result = await resetPasswordWithToken(email, token, password);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json({ message: "Your password has been reset. You can now sign in." });
  } catch (error: any) {
    console.error("RESET PASSWORD ERROR:", error?.message || error);
    return res.status(500).json({ error: "Unable to reset your password right now." });
  }
};

export const changePassword = async (req: AuthRequest, res: Response) => {
  const uid = req.user?.uid;
  const email = req.user?.email;
  if (!uid || !email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");

  try {
    await changeUserPassword(email, uid, currentPassword, newPassword);
    return res.json({ message: "Password updated." });
  } catch (error: any) {
    if (isAuthFlowError(error)) {
      const message =
        error.errorCode === "INVALID_CURRENT_PASSWORD"
          ? "Your current password is incorrect."
          : error.errorCode === "PASSWORD_NOT_AVAILABLE"
          ? "Password change isn't available for accounts created with Google sign-in."
          : error.errorCode === "WEAK_PASSWORD"
          ? "New password must be at least 6 characters."
          : error.message;
      return res.status(error.statusCode).json({ error: message });
    }
    console.error("CHANGE PASSWORD ERROR:", error?.message || error);
    return res.status(500).json({ error: "Unable to update your password right now." });
  }
};
