import { getEnvValue } from "./env";

export type AuthProvider = "local" | "firebase";

export function getAuthProvider(): AuthProvider {
  const provider = getEnvValue("AUTH_PROVIDER").toLowerCase();
  return provider === "firebase" ? "firebase" : "local";
}

export function useFirebaseAuth(): boolean {
  return getAuthProvider() === "firebase";
}

export function getFirestoreUsersCollectionName(): string {
  return getEnvValue("FIREBASE_USERS_COLLECTION") || "users";
}

