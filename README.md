# Lifeion Backend

## Setup

1. Copy `.env.example` to `.env`.
2. Fill all environment variables.
3. Install dependencies:

```bash
npm ci
```

## Commands

```bash
npm run dev
npm run lint
npm run build
npm run start
npm audit --omit=dev
```

## Contact Email (Free + Production Friendly)

Use Brevo free tier for reliable delivery from Railway (HTTPS API, not SMTP ports).

### Recommended env vars

```env
CONTACT_TO_EMAIL=your_inbox@gmail.com
BREVO_API_KEY=your_brevo_api_key
BREVO_FROM_EMAIL=verified_sender@yourdomain.com
BREVO_FROM_NAME=Life Ionizers
```

Notes:
- If `BREVO_API_KEY` is present, contact endpoint uses Brevo first.
- If `BREVO_API_KEY` is missing, it falls back to SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`).
- For production on Railway, Brevo API is preferred over Gmail SMTP.
