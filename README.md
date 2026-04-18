# Lifeion Backend

## Setup

1. Copy `.env.example` to `.env`.
2. Fill the required environment variables.
3. Install dependencies:

```bash
npm ci
```

## Railway Deploy

The logs you pasted show a successful build followed by a startup crash. That means Railway is reaching `npm run start`, but the app exits because required env vars are missing.

### Required variables

Set these in Railway service variables:

```env
JWT_SECRET=replace_me
ADMIN_ID=admin
ADMIN_PASSWORD=replace_me
RAZORPAY_KEY_ID=replace_me
RAZORPAY_KEY_SECRET=replace_me
RAZORPAY_WEBHOOK_SECRET=replace_me
```

For MySQL, this app now accepts either:

```env
DB_HOST=
DB_PORT=
DB_USER=
DB_PASS=
DB_NAME=
```

or Railway MySQL-style variables:

```env
MYSQLHOST=
MYSQLPORT=
MYSQLUSER=
MYSQLPASSWORD=
MYSQLDATABASE=
```

### Runtime

`package.json` now pins Node to `20.x`, which matches the AWS SDK packages already present in the lockfile and avoids the `EBADENGINE` warnings shown in the build logs.

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
