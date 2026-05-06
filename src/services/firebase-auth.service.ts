import axios from "axios";
import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { getEnvValue } from "../config/env";
import { firestore } from "../config/firebase";
import { getFirestoreUsersCollectionName } from "../config/auth-provider";

export interface SafeUser {
  uid: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  role: string;
}

export class AuthFlowError extends Error {
  statusCode: number;
  errorCode?: string;

  constructor(message: string, statusCode: number, errorCode?: string) {
    super(message);
    this.name = "AuthFlowError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

type RegisterPayload = {
  name: string;
  email: string;
  password: string;
  phone?: string | null;
  address?: string | null;
};

type FirestoreUserProfile = {
  uid?: string;
  name?: string;
  email?: string;
  phone?: string | null;
  address?: string | null;
  role?: string;
};

export type FirebaseAdminSession = {
  email: string;
  uid: string;
  username: string;
  role: "admin";
};

const auth = getAuth();
const usersCollection = firestore.collection(getFirestoreUsersCollectionName());

export function isAuthFlowError(error: unknown): error is AuthFlowError {
  return error instanceof AuthFlowError;
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function getFirebaseWebApiKey(): string {
  const key = getEnvValue("FIREBASE_WEB_API_KEY");
  if (!key) {
    throw new AuthFlowError(
      "FIREBASE_WEB_API_KEY is required for Firebase Auth login",
      500,
      "MISSING_FIREBASE_WEB_API_KEY"
    );
  }
  return key;
}

function getConfiguredFirebaseAdminEmails(): Set<string> {
  const raw = [
    getEnvValue("FIREBASE_ADMIN_EMAILS"),
    getEnvValue("FIREBASE_ADMIN_EMAIL"),
    getEnvValue("ADMIN_EMAILS"),
    getEnvValue("ADMIN_ID").includes("@") ? getEnvValue("ADMIN_ID") : "",
  ].join(",");
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function mapFirebaseAdminAuthError(error: any): AuthFlowError {
  switch (String(error?.code || "")) {
    case "auth/email-already-exists":
      return new AuthFlowError("Email already registered", 409, error.code);
    case "auth/invalid-email":
      return new AuthFlowError("Please enter a valid email address", 400, error.code);
    case "auth/invalid-password":
      return new AuthFlowError("Password must be at least 6 characters", 400, error.code);
    default:
      return new AuthFlowError("Unable to complete authentication request", 500, error?.code);
  }
}

function mapFirebaseIdentityToolkitError(error: unknown): AuthFlowError {
  if (axios.isAxiosError(error)) {
    const firebaseMessage = String(error.response?.data?.error?.message || "").trim();

    switch (firebaseMessage) {
      case "INVALID_LOGIN_CREDENTIALS":
      case "INVALID_PASSWORD":
      case "EMAIL_NOT_FOUND":
        return new AuthFlowError("Invalid email or password", 401, firebaseMessage);
      case "USER_DISABLED":
        return new AuthFlowError("This account has been disabled", 403, firebaseMessage);
      case "TOO_MANY_ATTEMPTS_TRY_LATER":
        return new AuthFlowError(
          "Too many login attempts. Please try again later.",
          429,
          firebaseMessage
        );
      case "OPERATION_NOT_ALLOWED":
        return new AuthFlowError(
          "Email/password sign-in is not enabled in Firebase Authentication",
          500,
          firebaseMessage
        );
      default:
        if (firebaseMessage) {
          return new AuthFlowError(`Firebase login failed: ${firebaseMessage}`, 400, firebaseMessage);
        }
    }
  }

  return new AuthFlowError("Unable to sign in right now", 500, "FIREBASE_LOGIN_FAILED");
}

async function upsertFirestoreUserProfile(params: {
  uid: string;
  email: string;
  name: string;
  phone: string | null;
  address: string | null;
  role: string;
  authProvider: "password" | "google";
  isNew: boolean;
}): Promise<void> {
  const { uid, email, name, phone, address, role, authProvider, isNew } = params;
  const ref = usersCollection.doc(uid);
  const now = Timestamp.now();
  const baseData: Record<string, unknown> = {
    uid,
    email,
    name,
    phone,
    address,
    role,
    auth_provider: authProvider,
    updated_at: now,
    last_login_at: now,
  };
  if (isNew) {
    baseData.created_at = now;
  }
  await ref.set(baseData, { merge: true });
}

async function readUserProfile(uid: string): Promise<FirestoreUserProfile> {
  const snap = await usersCollection.doc(uid).get();
  return snap.exists ? (snap.data() as FirestoreUserProfile) : {};
}

function buildSafeUser(uid: string, profile: FirestoreUserProfile, fallbackEmail: string): SafeUser {
  return {
    uid,
    name: String(profile.name || "").trim() || fallbackEmail.split("@")[0] || "Customer",
    email: String(profile.email || fallbackEmail || "").trim().toLowerCase(),
    phone: normalizeNullableString(profile.phone),
    address: normalizeNullableString(profile.address),
    role: String(profile.role || "customer"),
  };
}

export async function registerWithFirebaseAuth(payload: RegisterPayload): Promise<SafeUser> {
  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const phone = normalizeNullableString(payload.phone);
  const address = normalizeNullableString(payload.address);

  let firebaseUser;
  try {
    firebaseUser = await auth.createUser({
      email,
      password,
      displayName: name,
    });
  } catch (error) {
    throw mapFirebaseAdminAuthError(error);
  }

  try {
    await upsertFirestoreUserProfile({
      uid: firebaseUser.uid,
      email,
      name,
      phone,
      address,
      role: "customer",
      authProvider: "password",
      isNew: true,
    });

    return {
      uid: firebaseUser.uid,
      name,
      email,
      phone,
      address,
      role: "customer",
    };
  } catch (error) {
    await auth.deleteUser(firebaseUser.uid).catch(() => undefined);
    throw error;
  }
}

export async function loginWithFirebaseAuth(emailInput: string, password: string): Promise<SafeUser> {
  const email = String(emailInput || "").trim().toLowerCase();
  const apiKey = getFirebaseWebApiKey();

  const response = await signInWithFirebasePassword(email, password, apiKey);
  const uid = String(response.data?.localId || "").trim();
  if (!uid) {
    throw new AuthFlowError("Firebase login failed", 500, "MISSING_FIREBASE_UID");
  }

  const existingProfile = await readUserProfile(uid);
  const isNew = !existingProfile?.email;

  await upsertFirestoreUserProfile({
    uid,
    email,
    name: String(existingProfile.name || email.split("@")[0] || "Customer").trim(),
    phone: normalizeNullableString(existingProfile.phone),
    address: normalizeNullableString(existingProfile.address),
    role: String(existingProfile.role || "customer"),
    authProvider: "password",
    isNew,
  });

  const profile = await readUserProfile(uid);
  return buildSafeUser(uid, profile, email);
}

async function signInWithFirebasePassword(email: string, password: string, apiKey: string) {
  try {
    return await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        email,
        password,
        returnSecureToken: true,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    throw mapFirebaseIdentityToolkitError(error);
  }
}

export async function loginFirebaseAdmin(emailInput: string, password: string): Promise<FirebaseAdminSession> {
  const email = String(emailInput || "").trim().toLowerCase();
  const apiKey = getFirebaseWebApiKey();
  const response = await signInWithFirebasePassword(email, password, apiKey);
  const uid = String(response.data?.localId || "").trim();
  if (!uid) {
    throw new AuthFlowError("Firebase login failed", 500, "MISSING_FIREBASE_UID");
  }

  const [profile, firebaseUser] = await Promise.all([
    readUserProfile(uid),
    auth.getUser(uid),
  ]);

  const adminEmails = getConfiguredFirebaseAdminEmails();
  const hasAdminRole =
    String(profile?.role || "").trim().toLowerCase() === "admin" ||
    adminEmails.has(email) ||
    Boolean(firebaseUser.customClaims?.admin);

  if (!hasAdminRole) {
    throw new AuthFlowError("Admin access required", 403, "ADMIN_ACCESS_REQUIRED");
  }

  await upsertFirestoreUserProfile({
    uid,
    email,
    name: String(profile?.name || firebaseUser.displayName || email.split("@")[0] || "Admin").trim(),
    phone: normalizeNullableString(profile?.phone),
    address: normalizeNullableString(profile?.address),
    role: "admin",
    authProvider: "password",
    isNew: !profile?.email,
  });

  return {
    email,
    uid,
    username: String(profile?.name || firebaseUser.displayName || email),
    role: "admin",
  };
}

export async function upsertFirestoreUserFromGoogleLogin(params: {
  email: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  role?: string;
}): Promise<SafeUser> {
  const email = String(params.email || "").trim().toLowerCase();
  const name = String(params.name || "").trim() || email.split("@")[0];
  const phone = normalizeNullableString(params.phone);
  const address = normalizeNullableString(params.address);
  const role = String(params.role || "customer");

  const firebaseUser = await auth.getUserByEmail(email).catch(async () => {
    return auth.createUser({
      email,
      displayName: name,
    });
  });

  const existingProfile = await readUserProfile(firebaseUser.uid);

  await upsertFirestoreUserProfile({
    uid: firebaseUser.uid,
    email,
    name,
    phone: phone || normalizeNullableString(existingProfile.phone),
    address: address || normalizeNullableString(existingProfile.address),
    role,
    authProvider: "google",
    isNew: !existingProfile?.email,
  });

  const profile = await readUserProfile(firebaseUser.uid);
  return buildSafeUser(firebaseUser.uid, profile, email);
}

export async function getUserProfile(uid: string): Promise<SafeUser | null> {
  if (!uid) return null;
  const profile = await readUserProfile(uid);
  if (!profile?.email && !profile?.uid) return null;
  return buildSafeUser(uid, profile, String(profile.email || ""));
}
