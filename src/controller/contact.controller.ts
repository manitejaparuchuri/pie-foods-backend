import { Request, Response } from "express";
import axios from "axios";
import nodemailer from "nodemailer";

const REQUIRED_FIELDS: Array<keyof ContactPayload> = [
  "name",
  "email",
  "phone",
  "subject",
  "message",
];

type ContactPayload = {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
};

type ContactProviderResult = {
  message: string;
  code?: string;
};

type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

function formatIndiaTimestamp(date: Date): string {
  const IST_OFFSET_MINUTES = 330;
  const istDate = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);

  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istDate.getUTCDate()).padStart(2, "0");

  const hours24 = istDate.getUTCHours();
  const minutes = String(istDate.getUTCMinutes()).padStart(2, "0");
  const seconds = String(istDate.getUTCSeconds()).padStart(2, "0");
  const amPm = hours24 >= 12 ? "PM" : "AM";
  const hours12 = String(hours24 % 12 || 12).padStart(2, "0");

  return `${day}-${month}-${year} ${hours12}:${minutes}:${seconds} ${amPm} IST`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildContactEmailContent(payload: ContactPayload): EmailContent {
  const safeName = escapeHtml(payload.name.trim());
  const safeEmail = escapeHtml(payload.email.trim());
  const safePhone = escapeHtml(payload.phone.trim());
  const safeSubject = payload.subject.replace(/[\r\n]+/g, " ").trim();
  const safeSubjectHtml = escapeHtml(safeSubject);
  const safeMessageHtml = escapeHtml(payload.message.trim()).replace(/\r?\n/g, "<br/>");
  const submittedAt = formatIndiaTimestamp(new Date());

  const text = `
New contact enquiry received.

Name: ${payload.name.trim()}
Email: ${payload.email.trim()}
Phone: ${payload.phone.trim()}
Subject: ${safeSubject}
Submitted At (IST): ${submittedAt}

Message:
${payload.message.trim()}
  `.trim();

  const html = `
<div style="margin:0;padding:24px;background:#f3f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr>
      <td style="background:#00b7bb;padding:20px 24px;color:#ffffff;">
        <div style="font-size:22px;font-weight:700;letter-spacing:0.2px;">Life Ionizers</div>
        <div style="font-size:13px;opacity:0.95;margin-top:6px;">New Contact Form Enquiry</div>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 24px 8px 24px;">
        <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:12px;">${safeSubjectHtml}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:10px 0;border-top:1px solid #eef2f7;width:140px;color:#6b7280;font-size:13px;">Name</td>
            <td style="padding:10px 0;border-top:1px solid #eef2f7;font-size:14px;font-weight:600;color:#111827;">${safeName}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid #eef2f7;width:140px;color:#6b7280;font-size:13px;">Email</td>
            <td style="padding:10px 0;border-top:1px solid #eef2f7;font-size:14px;">
              <a href="mailto:${safeEmail}" style="color:#0b72b9;text-decoration:none;">${safeEmail}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid #eef2f7;width:140px;color:#6b7280;font-size:13px;">Phone</td>
            <td style="padding:10px 0;border-top:1px solid #eef2f7;font-size:14px;color:#111827;">${safePhone}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid #eef2f7;width:140px;color:#6b7280;font-size:13px;">Submitted At</td>
            <td style="padding:10px 0;border-top:1px solid #eef2f7;font-size:14px;color:#111827;">${submittedAt}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 24px 24px 24px;">
        <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">Message</div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;line-height:1.6;font-size:14px;color:#111827;">
          ${safeMessageHtml}
        </div>
      </td>
    </tr>
  </table>
</div>
  `.trim();

  return {
    subject: `[Contact] ${safeSubject}`,
    text,
    html,
  };
}

function isTimeoutLikeError(err: any): boolean {
  const code = String(err?.code || "").toUpperCase();
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNECTION" ||
    code === "ENOTFOUND" ||
    code === "ESOCKET"
  );
}

function mapSmtpErrorMessage(err: any): string {
  const code = String(err?.code || "").toUpperCase();

  if (code === "EAUTH") {
    return "SMTP authentication failed. Check SMTP_USER and SMTP_PASS.";
  }

  if (isTimeoutLikeError(err)) {
    return "Unable to connect to SMTP server. Please try again later.";
  }

  return "Failed to send contact email";
}

function mapBrevoError(err: any): ContactProviderResult {
  const code = String(err?.code || "").toUpperCase();

  if (code === "BREVO_FROM_MISSING") {
    return {
      message: "BREVO_FROM_EMAIL is required when BREVO_API_KEY is set.",
      code,
    };
  }

  if (code === "BREVO_NOT_CONFIGURED") {
    return {
      message: "Brevo is not configured.",
      code,
    };
  }

  if (axios.isAxiosError(err)) {
    const status = err.response?.status;

    if (status === 401 || status === 403) {
      return {
        message: "Brevo authentication failed. Check BREVO_API_KEY.",
        code: "BREVO_AUTH",
      };
    }

    if (status === 429) {
      return {
        message: "Brevo rate limit reached. Please try again later.",
        code: "BREVO_RATE_LIMIT",
      };
    }

    if (status && status >= 500) {
      return {
        message: "Brevo service is temporarily unavailable.",
        code: "BREVO_SERVER_ERROR",
      };
    }

    if (err.code === "ECONNABORTED") {
      return {
        message: "Brevo request timed out. Please try again later.",
        code: "BREVO_TIMEOUT",
      };
    }

    return {
      message: "Failed to send contact email via Brevo.",
      code: "BREVO_REQUEST_ERROR",
    };
  }

  return {
    message: "Failed to send contact email via Brevo.",
    code: "BREVO_UNKNOWN_ERROR",
  };
}

function getBrevoConfig() {
  const apiKey = String(process.env.BREVO_API_KEY || "").trim();
  const fromEmail = String(
    process.env.BREVO_FROM_EMAIL || process.env.SMTP_USER || ""
  ).trim();
  const fromName = String(process.env.BREVO_FROM_NAME || "Life Ionizers").trim();

  return {
    apiKey,
    fromEmail,
    fromName,
  };
}

async function sendWithBrevo(
  payload: ContactPayload,
  toAddress: string
): Promise<void> {
  const { apiKey, fromEmail, fromName } = getBrevoConfig();
  const content = buildContactEmailContent(payload);

  if (!apiKey) {
    throw { code: "BREVO_NOT_CONFIGURED" };
  }

  if (!fromEmail) {
    throw { code: "BREVO_FROM_MISSING" };
  }

  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: { name: fromName, email: fromEmail },
      to: [{ email: toAddress }],
      replyTo: { email: payload.email, name: payload.name },
      subject: content.subject,
      textContent: content.text,
      htmlContent: content.html,
    },
    {
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  );
}

async function sendWithSmtp(
  payload: ContactPayload,
  toAddress: string
): Promise<void> {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw { code: "SMTP_NOT_CONFIGURED", message: "Missing SMTP env vars" };
  }

  const smtpHost = SMTP_HOST.trim();
  const smtpUser = SMTP_USER.trim();
  const smtpPass = SMTP_PASS.replace(/\s+/g, "");
  const smtpPort = Number(SMTP_PORT);

  if (!Number.isFinite(smtpPort)) {
    throw { code: "SMTP_INVALID_PORT", message: "Invalid SMTP_PORT" };
  }
  const content = buildContactEmailContent(payload);

  const mailOptions = {
    from: `"Website Contact" <${smtpUser}>`,
    to: toAddress,
    replyTo: payload.email,
    subject: content.subject,
    text: content.text,
    html: content.html,
  };

  const portCandidates =
    smtpHost.includes("gmail") && (smtpPort === 587 || smtpPort === 465)
      ? [smtpPort, smtpPort === 587 ? 465 : 587]
      : [smtpPort];

  let lastError: any = null;

  for (const port of portCandidates) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      dnsTimeout: 10000,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    try {
      await Promise.race([
        transporter.sendMail(mailOptions),
        new Promise((_, reject) =>
          setTimeout(() => reject({ code: "ETIMEDOUT", message: "SMTP send timeout" }), 16000)
        ),
      ]);
      return;
    } catch (err) {
      lastError = err;
      console.error("SEND CONTACT EMAIL ERROR:", {
        attemptedPort: port,
        code: (err as any)?.code,
        responseCode: (err as any)?.responseCode,
        command: (err as any)?.command,
        response: (err as any)?.response,
        message: (err as any)?.message,
      });

      if (!isTimeoutLikeError(err)) {
        break;
      }
    }
  }

  throw lastError || { code: "UNKNOWN_SMTP_ERROR" };
}

function isValidPayload(body: any): body is ContactPayload {
  return (
    body &&
    REQUIRED_FIELDS.every(
      (key) =>
        typeof body[key] === "string" &&
        String(body[key]).trim().length > 0
    )
  );
}

export const submitContact = async (req: Request, res: Response) => {
  if (!isValidPayload(req.body)) {
    return res.status(400).json({ message: "Invalid contact payload" });
  }

  const toAddress =
    process.env.CONTACT_TO_EMAIL || "shurya.kumar478@gmail.com";
  const payload = req.body as ContactPayload;
  const hasBrevo = Boolean(String(process.env.BREVO_API_KEY || "").trim());

  if (hasBrevo) {
    try {
      await sendWithBrevo(payload, toAddress);
      return res.json({ message: "Contact message sent" });
    } catch (err) {
      const brevoError = mapBrevoError(err);
      console.error("BREVO CONTACT EMAIL ERROR:", {
        code: (err as any)?.code,
        status: axios.isAxiosError(err) ? err.response?.status : undefined,
        message: (err as any)?.message,
      });
      return res.status(500).json(brevoError);
    }
  }

  try {
    await sendWithSmtp(payload, toAddress);
    return res.json({ message: "Contact message sent" });
  } catch (err) {
    return res.status(500).json({
      message: mapSmtpErrorMessage(err),
      code: (err as any)?.code || "UNKNOWN_SMTP_ERROR",
    });
  }
};
