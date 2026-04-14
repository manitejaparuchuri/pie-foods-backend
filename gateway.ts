import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";

const app = express();
app.use(cors());

app.use(
  "/api/categories",
  createProxyMiddleware({
    target: "http://localhost:4001",
    changeOrigin: true,
    pathRewrite: { "^/api/categories": "/api/categories" },
  })
);

//  PRODUCT SERVICE (example running on port 4002)
app.use(
  "/api/products",
  createProxyMiddleware({
    target: "http://localhost:4002",
    changeOrigin: true,
    pathRewrite: { "^/api/products": "/api/products" },
  })
);

//  AUTH SERVICE, if needed
// app.use(
//   "/api/auth",
//   createProxyMiddleware({
//     target: "http://localhost:4003",
//     changeOrigin: true,
//     pathRewrite: { "^/api/auth": "/api/auth" },
//   })
// );

app.listen(3000, () => {
  console.log("✅ API Gateway running on http://localhost:3000");
});
