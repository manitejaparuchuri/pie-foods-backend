import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { firestore } from "../config/firebase";
import { sendEmail } from "./email.service";

/* ===================================================================
   Password Reset Service
   ===================================================================
   "Forgot password" flow for customer accounts that sign in with a
   Firebase email/password credential.

   Storage: `password_resets` collection, doc id = sha256(email).
   - token_hash: sha256 of a 32-byte base64url token (never store plaintext)
   - email / uid: who the reset is for
   - expires_at: 30 minutes from issue
   - used: flipped true on a successful reset (single-use)

   The request endpoint never reveals whether the email exists; it always
   returns the same generic success message. Only accounts that actually
   have a password provider receive an email.
   =================================================================== */

const auth = getAuth();
const passwordResetsCollection = firestore.collection("password_resets");

const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

function emailKey(email: string): string {
  return crypto
    .createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getSiteBaseUrl(): string {
  return String(process.env.SITE_BASE_URL || "https://www.piefoods.com").replace(
    /\/+$/,
    ""
  );
}

/**
 * Generate a single-use reset token, store its sha256, and email the user a
 * reset link. If the account doesn't exist or has no password provider, we
 * silently skip the email — the caller still returns the generic 200 so the
 * endpoint never leaks which addresses are registered.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

  // Look up the Firebase user. Missing user → nothing to do (but stay silent).
  const firebaseUser = await auth.getUserByEmail(email).catch(() => null);
  if (!firebaseUser) return;

  // Only password-based accounts can have their password reset this way.
  const hasPasswordProvider = firebaseUser.providerData.some(
    (provider) => provider.providerId === "password"
  );
  if (!hasPasswordProvider) return;

  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();

  await passwordResetsCollection.doc(emailKey(email)).set(
    {
      email,
      uid: firebaseUser.uid,
      token_hash: hashToken(token),
      expires_at: Timestamp.fromMillis(now + RESET_TTL_MS),
      used: false,
      created_at: Timestamp.now(),
    },
    { merge: false } // overwrite any prior reset — only the latest link works
  );

  const resetUrl = `${getSiteBaseUrl()}/reset-password?token=${token}&email=${encodeURIComponent(
    email
  )}`;

  const subject = "Reset your PIE Foods password";
  const html = buildResetEmailHtml(resetUrl);
  const text = `Reset your PIE Foods password.\n\nWe received a request to reset the password for your PIE Foods account. Open the link below to choose a new password:\n\n${resetUrl}\n\nThis link expires in 30 minutes. If you didn't request this, you can safely ignore this email.\n\n— Team PIE Foods`;

  await sendEmail({ to: email, subject, html, text });
}

export type ResetPasswordOutcome =
  | { ok: true }
  | { ok: false; status: 400; error: string };

/**
 * Validate a reset token for the given email and, if valid, update the
 * Firebase password. Single-use: the reset doc is marked used on success.
 */
export async function resetPasswordWithToken(
  rawEmail: string,
  rawToken: string,
  newPassword: string
): Promise<ResetPasswordOutcome> {
  const email = String(rawEmail || "").trim().toLowerCase();
  const token = String(rawToken || "").trim();
  const password = String(newPassword || "");

  const invalid: ResetPasswordOutcome = {
    ok: false,
    status: 400,
    error: "This reset link is invalid or has expired. Please request a new one.",
  };

  if (!email || !token) return invalid;

  // Reject a too-short password BEFORE consuming the token, so a length error
  // never burns an otherwise-valid reset link.
  if (password.length < 6) {
    return {
      ok: false,
      status: 400,
      error: "Password must be at least 6 characters.",
    };
  }

  const docRef = passwordResetsCollection.doc(emailKey(email));
  const providedHash = hashToken(token);

  // Validate AND consume the token atomically in one transaction, so the link
  // is truly single-use even under concurrent requests or a partial failure
  // (a swallowed consume-write would otherwise leave it replayable for the TTL).
  let uid: string;
  try {
    const claimedUid = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return null;

      const data = snap.data() as Record<string, unknown>;
      if (data.used === true) return null;

      const expires = data.expires_at as Timestamp | undefined;
      if (!expires || expires.toMillis() < Date.now()) return null;

      const storedHash = String(data.token_hash || "");
      // Constant-time compare to avoid leaking the token via timing.
      const matches =
        storedHash.length === providedHash.length &&
        crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(providedHash));
      if (!matches) return null;

      const resolvedUid = String(data.uid || "");
      if (!resolvedUid) return null;

      tx.update(docRef, { used: true, used_at: Timestamp.now() });
      return resolvedUid;
    });

    if (!claimedUid) return invalid;
    uid = claimedUid;
  } catch (err) {
    // Could not safely consume the token — fail closed rather than risk a replay.
    console.error("resetPasswordWithToken transaction error:", err);
    return invalid;
  }

  try {
    await auth.updateUser(uid, { password });
  } catch (error: any) {
    if (String(error?.code || "") === "auth/invalid-password") {
      return {
        ok: false,
        status: 400,
        error: "Password must be at least 6 characters.",
      };
    }
    throw error;
  }

  return { ok: true };
}

function buildResetEmailHtml(resetUrl: string): string {
  return `
<div style="margin:0;padding:24px;background:#f3f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr>
      <td style="background:#2f3b2d;padding:20px 24px;color:#fff;">
        <div style="font-size:22px;font-weight:700;">PIE Foods</div>
        <div style="font-size:13px;opacity:0.95;margin-top:6px;">Password reset</div>
      </td>
    </tr>
    <tr>
      <td style="padding:30px 24px;">
        <p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.6;">
          We received a request to reset the password for your PIE Foods account.
          Click the button below to choose a new password.
        </p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${resetUrl}" style="display:inline-block;padding:13px 28px;background:#14532d;color:#fff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600;">
            Reset your password
          </a>
        </div>
        <p style="margin:14px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
          This link expires in <strong>30 minutes</strong>.<br>
          If you didn't request this, you can safely ignore this email — your
          password won't change.
        </p>
        <p style="margin:18px 0 0;font-size:12px;color:#9ca3af;word-break:break-all;">
          Button not working? Paste this link into your browser:<br>
          ${resetUrl}
        </p>
        <p style="margin:24px 0 0;font-size:13px;color:#111827;font-weight:600;">— Team PIE Foods</p>
      </td>
    </tr>
  </table>
</div>
  `.trim();
}
