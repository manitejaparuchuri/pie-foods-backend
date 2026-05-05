import { formatEnvRequirement, getEnvValue, getMissingRequiredEnvVars } from "./config/env";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { join } from "path";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import categoryRoutes from "./routers/category.routes";
import productRoutes from "./routers/product.routes";
import loginRoutes from "./routers/login.routes";
import cartRoutes from "./routers/cart.routes";
import checkoutRoutes from "./routers/checkout.routes";
import shippingRoutes from "./routers/shipping.routes";
import orderRoutes from "./routers/order.routes";
import paymentRoutes from "./routers/payment.routes";
import reviewRoutes from "./routers/review.routes";
import contactRoutes from "./routers/contact.routes";
import adminRoutes from "./routers/admin.routes";
import comboRoutes from "./routers/combo.routes";
import bannerRoutes from "./routers/banner.routes";

const app = express();
app.disable("x-powered-by");

const requiredEnvVars = [
  "DB_HOST",
  "DB_USER",
  "DB_PASS",
  "DB_NAME",
  "JWT_SECRET",
  "ADMIN_ID",
  "ADMIN_PASSWORD",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
];

const missingEnvVars = getMissingRequiredEnvVars(requiredEnvVars);

if (missingEnvVars.length) {
  throw new Error(
    `Missing required environment variables: ${missingEnvVars
      .map(formatEnvRequirement)
      .join(", ")}`
  );
}

console.log("Database config detected:", {
  host: getEnvValue("DB_HOST"),
  db: getEnvValue("DB_NAME"),
  port: getEnvValue("DB_PORT") || "3306",
});

const defaultAllowedOrigins = [
  "https://lifeionizersindia.com",
  "https://www.lifeionizersindia.com",
  "http://localhost:4200",
];

const envAllowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...defaultAllowedOrigins, ...envAllowedOrigins]);

function isLocalDevOrigin(origin: string): boolean {
  return (
    /^http:\/\/localhost:\d+$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
  );
}

app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin) || isLocalDevOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/admin/login", authLimiter);

app.use("/api/auth", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use("/api/admin", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(
  "/api/payment/webhook",
  express.raw({ type: "application/json", limit: "1mb" })
);
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req: Request, res: Response) => {
  return res.status(200).json({ status: "ok" });
});

const assetsPath = join(__dirname, "../assets");
app.use(
  "/assets",
  express.static(assetsPath, {
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);

app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/auth", loginRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/combos", comboRoutes);
app.use("/api/banners", bannerRoutes);
app.use("/api/admin", adminRoutes);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "CORS blocked this origin" });
  }

  console.error("UNHANDLED APP ERROR:", err);
  return res.status(500).json({ message: "Server error" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
