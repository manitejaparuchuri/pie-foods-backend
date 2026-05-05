import bcrypt from "bcryptjs";
import axios from "axios";
import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import db from "../config/db";
import { getEnvValue } from "../config/env";
import { firestore } from "../config/firebase";
import { getFirestoreUsersCollectionName } from "../config/auth-provider";

export interface SafeUser {
  user_id: number;
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

type UserRow = {
  user_id: number | string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  role: string;
};

type FirestoreUserProfile = {
  firebase_uid?: string;
  user_id?: number;
  name?: string;
  email?: string;
  phone?: string | null;
  address?: string | null;
  role?: string;
};

export type FirebaseAdminSession = {
  email: string;
  firebaseUid: string;
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

function toSafeUser(user: UserRow): SafeUser {
  return {
    user_id: Number(user.user_id),
    name: String(user.name || ""),
    email: String(user.email || ""),
    phone: user.phone ?? null,
    address: user.address ?? null,
    role: String(user.role || "customer"),
  };
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

async function ensureFirestoreUserProfile(params: {
  firebaseUid: string;
  localUser: SafeUser;
  authProvider: "password" | "google";
}): Promise<void> {
  const { firebaseUid, localUser, authProvider } = params;
  await usersCollection.doc(firebaseUid).set(
    {
      firebase_uid: firebaseUid,
      user_id: localUser.user_id,
      name: localUser.name,
      email: localUser.email,
      phone: localUser.phone,
      address: localUser.address,
      role: localUser.role,
      auth_provider: authProvider,
      updated_at: Timestamp.now(),
      last_login_at: Timestamp.now(),
      created_at: Timestamp.now(),
    },
    { merge: true }
  );
}

async function createLocalMirrorUser(params: {
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  role?: string;
}): Promise<SafeUser> {
  const placeholderPasswordHash = await bcrypt.hash(
    `firebase-auth-placeholder:${Date.now()}:${Math.random()}`,
    10
  );

  const [result]: any = await db.query(
    `INSERT INTO users (name, email, password_hash, phone, address, role)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      params.name,
      params.email,
      placeholderPasswordHash,
      normalizeNullableString(params.phone),
      normalizeNullableString(params.address),
      params.role || "customer",
    ]
  );

  return {
    user_id: Number(result.insertId),
    name: params.name,
    email: params.email,
    phone: normalizeNullableString(params.phone),
    address: normalizeNullableString(params.address),
    role: params.role || "customer",
  };
}

async function getLocalUserByEmail(email: string): Promise<SafeUser | null> {
  const [rows]: any = await db.query(
    `SELECT user_id, name, email, phone, address, role
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email]
  );

  if (!rows.length) {
    return null;
  }

  return toSafeUser(rows[0]);
}

async function buildLocalUserFromFirebase(firebaseUid: string, email: string): Promise<SafeUser> {
  const [docSnapshot, firebaseUser] = await Promise.all([
    usersCollection.doc(firebaseUid).get(),
    auth.getUser(firebaseUid),
  ]);

  const profile = docSnapshot.exists ? (docSnapshot.data() as FirestoreUserProfile) : {};
  const name =
    String(profile?.name || firebaseUser.displayName || email.split("@")[0] || "Customer").trim();
  const phone = normalizeNullableString(profile?.phone || firebaseUser.phoneNumber);
  const address = normalizeNullableString(profile?.address);
  const role = String(profile?.role || "customer");

  const localUser = await createLocalMirrorUser({
    name,
    email,
    phone,
    address,
    role,
  });

  await ensureFirestoreUserProfile({
    firebaseUid,
    localUser,
    authProvider: "password",
  });

  return localUser;
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

  let localUser: SafeUser | null = null;

  try {
    localUser =
      (await getLocalUserByEmail(email)) ||
      (await createLocalMirrorUser({
        name,
        email,
        phone,
        address,
        role: "customer",
      }));

    await ensureFirestoreUserProfile({
      firebaseUid: firebaseUser.uid,
      localUser,
      authProvider: "password",
    });

    return localUser;
  } catch (error) {
    if ((error as any)?.code === "ER_DUP_ENTRY") {
      const existingLocalUser = await getLocalUserByEmail(email);
      if (existingLocalUser) {
        await ensureFirestoreUserProfile({
          firebaseUid: firebaseUser.uid,
          localUser: existingLocalUser,
          authProvider: "password",
        });
        return existingLocalUser;
      }
    }

    await auth.deleteUser(firebaseUser.uid).catch(() => undefined);
    throw error;
  }
}

export async function loginWithFirebaseAuth(emailInput: string, password: string): Promise<SafeUser> {
  const email = String(emailInput || "").trim().toLowerCase();
  const apiKey = getFirebaseWebApiKey();

  const response = await signInWithFirebasePassword(email, password, apiKey);
  const firebaseUid = String(response.data?.localId || "").trim();
  if (!firebaseUid) {
    throw new AuthFlowError("Firebase login failed", 500, "MISSING_FIREBASE_UID");
  }

  let localUser = await getLocalUserByEmail(email);
  if (!localUser) {
    localUser = await buildLocalUserFromFirebase(firebaseUid, email);
  }

  await ensureFirestoreUserProfile({
    firebaseUid,
    localUser,
    authProvider: "password",
  });

  return localUser;
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
  const firebaseUid = String(response.data?.localId || "").trim();
  if (!firebaseUid) {
    throw new AuthFlowError("Firebase login failed", 500, "MISSING_FIREBASE_UID");
  }

  const [userProfileSnapshot, firebaseUser] = await Promise.all([
    usersCollection.doc(firebaseUid).get(),
    auth.getUser(firebaseUid),
  ]);

  const profile = userProfileSnapshot.exists
    ? (userProfileSnapshot.data() as FirestoreUserProfile)
    : {};
  const adminEmails = getConfiguredFirebaseAdminEmails();
  const hasAdminRole =
    String(profile?.role || "").trim().toLowerCase() === "admin" ||
    adminEmails.has(email) ||
    Boolean(firebaseUser.customClaims?.admin);

  if (!hasAdminRole) {
    throw new AuthFlowError("Admin access required", 403, "ADMIN_ACCESS_REQUIRED");
  }

  await usersCollection.doc(firebaseUid).set(
    {
      firebase_uid: firebaseUid,
      email,
      name: profile?.name || firebaseUser.displayName || email.split("@")[0],
      role: "admin",
      auth_provider: "password",
      updated_at: Timestamp.now(),
      last_login_at: Timestamp.now(),
      created_at: Timestamp.now(),
    },
    { merge: true }
  );

  return {
    email,
    firebaseUid,
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
  const existingLocalUser = await getLocalUserByEmail(email);
  const firebaseUser = await auth.getUserByEmail(email).catch(async () => {
    return auth.createUser({
      email,
      displayName: params.name,
    });
  });

  const localUser =
    existingLocalUser ||
    (await createLocalMirrorUser({
      name: params.name,
      email,
      phone: params.phone,
      address: params.address,
      role: params.role || "customer",
    }));

  await ensureFirestoreUserProfile({
    firebaseUid: firebaseUser.uid,
    localUser,
    authProvider: "google",
  });

  return localUser;
}
