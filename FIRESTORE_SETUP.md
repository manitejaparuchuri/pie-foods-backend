# Firestore Catalog Setup

This first phase moves only `categories` and `products` to Firestore.

The rest of the backend still uses MySQL for now:
- auth
- cart
- shipping
- orders
- payments
- reviews
- admin dashboard internals

## 1. Create Firestore

1. Open Firebase Console.
2. Create a new project or use an existing one.
3. Open `Firestore Database`.
4. Click `Create database`.
5. Choose `Production mode`.
6. Pick a region close to your users.
   Recommended: `asia-south1 (Mumbai)` if available in your Firebase project.

## 2. Create a service account key

1. Open `Project settings`.
2. Open `Service accounts`.
3. Click `Generate new private key`.
4. Save the JSON file somewhere outside git if possible.

Example local path:

```text
C:\com\pie-foods\pie-foods-backend\secrets\firebase-service-account.json
```

## 3. Update backend env

In `pie-foods-backend/.env`, add:

```env
CATALOG_DATA_SOURCE=firestore
AUTH_PROVIDER=firebase
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json
FIREBASE_WEB_API_KEY=your_firebase_web_api_key
FIREBASE_USERS_COLLECTION=users
FIREBASE_CATEGORIES_COLLECTION=categories
FIREBASE_PRODUCTS_COLLECTION=products
```

For Railway/hosted deployment, do not use `FIREBASE_SERVICE_ACCOUNT_PATH` unless the JSON file is actually deployed with the app. Prefer these variables:

```env
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-admin-sdk-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

The backend also supports `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_BASE64` if your hosting provider makes that easier.

## 3.1 Enable Firebase Authentication

1. Open `Firebase Console`.
2. Open `Authentication`.
3. Click `Get started`.
4. Enable `Email/Password`.
5. Copy your project `Web API Key` from project settings and place it in:

```env
FIREBASE_WEB_API_KEY=your_firebase_web_api_key
```

With this setup:
- Firebase Auth stores customer credentials
- your backend still returns the same JWT shape used by the frontend
- your backend also keeps a mirrored local SQL user row so cart/orders/payments continue to work during migration

## 4. Sync your current catalog

Run this from `pie-foods-backend`:

```powershell
npm run firestore:sync-catalog
```

What it does:
- reads current MySQL `categories`
- reads current MySQL `products`
- writes them to Firestore
- also creates a third category for `Monk Fruit Drops` so your home banner structure can be represented now, even if products are added later

## 5. Start backend

```powershell
npm run dev
```

Now these public APIs will read from Firestore:
- `GET /api/categories`
- `GET /api/categories/:id`
- `GET /api/categories/with-products/all`
- `GET /api/products`
- `GET /api/products/:id`
- `GET /api/products/category/:categoryId`

Your auth APIs can also use Firebase Auth when `AUTH_PROVIDER=firebase`:
- `POST /api/auth/register`
- `POST /api/auth/login`

## 6. Verify

Check:

```text
http://localhost:3000/api/categories
http://localhost:3000/api/products
```

You should see:
- `Fruit Chips`
- `Natural Sweeteners`
- `Monk Fruit Drops`

## Important note

Because cart, order, and payment code still use MySQL, the Firestore sync keeps the same numeric `product_id` and `category_id` values from MySQL wherever possible. This avoids breaking the current add-to-cart and checkout flow while we migrate in phases.
