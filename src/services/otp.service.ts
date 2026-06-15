import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";
import { sendEmail } from "./email.service";

/* ===================================================================
   OTP (One-Time Password) Service
   ===================================================================
   Email-based 6-digit OTP login. Used by guest customers to access
   their order history without setting a password.

   Storage: `otp_codes` collection, doc id = sha256(email).
   - code_hash: bcrypt of the 6-digit code (never store plaintext)
   - expires_at: 10 minutes from issue
   - attempts: incremented on each verify; lock after 5 wrong tries
   - sends_in_window: rate limit — max 3 sends per 10 min per email

   Codes are single-use: deleted on successful verification.
   =================================================================== */

const otpCollection = firestore.collection("otp_codes");

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_SENDS_PER_WINDOW = 3;
const SEND_WINDOW_MS = 10 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

function emailKey(email: string): string {
  return crypto
    .createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
}

function generateSixDigitCode(): string {
  // crypto.randomInt is uniform — safer than Math.random
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface OtpRequestResult {
  ok: true;
  expiresInSeconds: number;
}

export class OtpRateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Too many OTP requests. Please wait and try again.");
  }
}

export class OtpInvalidError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Generate a 6-digit OTP, store its bcrypt hash, and email it to the user.
 * Rate-limited: max 3 sends per email per 10 minutes.
 */
export async function requestOtp(rawEmail: string): Promise<OtpRequestResult> {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OtpInvalidError("A valid email is required");
  }

  const docRef = otpCollection.doc(emailKey(email));
  const now = Date.now();

  // Rate-limit checks: read first, then enforce
  const existing = await docRef.get();
  if (existing.exists) {
    const data = existing.data() as Record<string, unknown>;
    const sends = Array.isArray(data.send_timestamps)
      ? (data.send_timestamps as number[])
      : [];
    const recent = sends.filter((t) => now - t < SEND_WINDOW_MS);
    if (recent.length >= MAX_SENDS_PER_WINDOW) {
      const oldest = Math.min(...recent);
      const wait = Math.max(1, Math.ceil((SEND_WINDOW_MS - (now - oldest)) / 1000));
      throw new OtpRateLimitError(wait);
    }
  }

  const code = generateSixDigitCode();
  const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);

  // Update / create the OTP record. Reset attempt counter on each new send.
  const recentSends = existing.exists
    ? (
        (existing.data() as Record<string, unknown>).send_timestamps as
          | number[]
          | undefined
      )?.filter((t) => now - t < SEND_WINDOW_MS) ?? []
    : [];

  await docRef.set(
    {
      email,
      code_hash: codeHash,
      expires_at: Timestamp.fromMillis(now + OTP_TTL_MS),
      attempts: 0,
      send_timestamps: [...recentSends, now],
      updated_at: Timestamp.now(),
    },
    { merge: false } // overwrite on new send — old code is invalidated
  );

  // Best-effort email send. If the email provider is down, surface a 503-style
  // error so the user knows to retry. We DON'T leak whether the email exists.
  const subject = `Your PIE Foods login code: ${code}`;
  const html = buildOtpEmailHtml(code);
  const text = `Your PIE Foods login code is ${code}. It expires in 10 minutes. If you didn't request this, you can safely ignore this email.`;

  const sent = await sendEmail({ to: email, subject, html, text });
  if (!sent) {
    // Don't leave a half-state — delete the unsent OTP so the user can retry
    await docRef.delete().catch(() => undefined);
    throw new Error("Could not send the verification email. Please try again.");
  }

  return { ok: true, expiresInSeconds: Math.floor(OTP_TTL_MS / 1000) };
}

/**
 * Verify a submitted code against the stored bcrypt hash.
 * Single-use: deletes the record on success.
 */
export async function verifyOtp(
  rawEmail: string,
  rawCode: string
): Promise<{ email: string }> {
  const email = String(rawEmail || "").trim().toLowerCase();
  const code = String(rawCode || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OtpInvalidError("A valid email is required");
  }
  if (!/^[0-9]{6}$/.test(code)) {
    throw new OtpInvalidError("Enter the 6-digit code");
  }

  const docRef = otpCollection.doc(emailKey(email));
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new OtpInvalidError("Code is invalid or expired");
  }

  const data = snap.data() as Record<string, unknown>;
  const expires = data.expires_at as Timestamp | undefined;
  if (!expires || expires.toMillis() < Date.now()) {
    await docRef.delete().catch(() => undefined);
    throw new OtpInvalidError("Code is invalid or expired");
  }

  const attempts = Number(data.attempts || 0);
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    await docRef.delete().catch(() => undefined);
    throw new OtpInvalidError("Too many wrong attempts. Request a new code.");
  }

  const codeHash = String(data.code_hash || "");
  const ok = await bcrypt.compare(code, codeHash);

  if (!ok) {
    await docRef.update({
      attempts: attempts + 1,
      updated_at: Timestamp.now(),
    });
    throw new OtpInvalidError("Code is invalid or expired");
  }

  // Success — single-use
  await docRef.delete().catch(() => undefined);
  return { email };
}

function buildOtpEmailHtml(code: string): string {
  return `
<div style="margin:0;padding:24px;background:#f3f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr>
      <td style="background:#2f3b2d;padding:20px 24px;color:#fff;">
        <div style="font-size:22px;font-weight:700;">PIE Foods</div>
        <div style="font-size:13px;opacity:0.95;margin-top:6px;">Your login code</div>
      </td>
    </tr>
    <tr>
      <td style="padding:30px 24px;text-align:center;">
        <p style="margin:0 0 14px;font-size:15px;color:#374151;">
          Use this code to sign in to your PIE Foods account:
        </p>
        <div style="display:inline-block;padding:18px 28px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;margin:8px 0 18px;">
          <span style="font-size:34px;font-weight:700;color:#14532d;letter-spacing:0.4em;font-family:'Courier New',monospace;">
            ${code}
          </span>
        </div>
        <p style="margin:14px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
          This code expires in <strong>10 minutes</strong>.<br>
          If you didn't request this, you can safely ignore this email.
        </p>
        <p style="margin:24px 0 0;font-size:13px;color:#111827;font-weight:600;">— Team PIE Foods</p>
      </td>
    </tr>
  </table>
</div>
  `.trim();
}
