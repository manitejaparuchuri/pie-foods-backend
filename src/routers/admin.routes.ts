import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import {
  adminLogin,
  changeAdminPassword,
  createCategory,
  updateCategory,
  deleteCategory,
  getDbTables,
  getDbTableRows,
  getApiCatalog,
  getAdminBootstrap,
  createProduct,
  updateProduct,
  deleteProduct,
  createCombo,
  updateCombo,
  deleteCombo,
  createBanner,
  updateBanner,
  deleteBanner,
  updatePopularProductsShowcase,
  updateTrialPack,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  getCoupons,
  getCouponById,
  uploadAdminImage,
} from "../controller/admin.controller";
import { verifyToken } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/admin";
import upload from "../middlewares/upload";

const router = Router();

router.post("/login", adminLogin);

router.use(verifyToken, requireAdmin);

router.put("/change-password", changeAdminPassword);

router.get("/bootstrap", getAdminBootstrap);
router.get("/db/tables", getDbTables);
router.get("/db/tables/:tableName", getDbTableRows);
router.get("/apis", getApiCatalog);
// Wrap multer.single so its errors (oversize file, wrong mimetype, missing
// part) come back as a clean 400 JSON instead of a stack-trace 500.
const acceptImage = upload.single("image");
router.post(
  "/upload/image",
  (req: Request, res: Response, next: NextFunction) => {
    acceptImage(req, res, (err: unknown) => {
      if (!err) return next();
      const message =
        err instanceof multer.MulterError
          ? err.code === "LIMIT_FILE_SIZE"
            ? "Image is too large (max 5 MB)."
            : `Upload failed (${err.code}).`
          : (err as Error)?.message || "Invalid upload";
      console.error("UPLOAD MIDDLEWARE ERROR:", err);
      return res.status(400).json({ message });
    });
  },
  uploadAdminImage
);

router.post("/categories", createCategory);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);

router.post("/products", createProduct);
router.put("/products/:id", updateProduct);
router.delete("/products/:id", deleteProduct);

router.post("/combos", createCombo);
router.put("/combos/:id", updateCombo);
router.delete("/combos/:id", deleteCombo);

router.post("/banners", createBanner);
router.put("/banners/:id", updateBanner);
router.delete("/banners/:id", deleteBanner);

router.put("/popular-products", updatePopularProductsShowcase);

router.put("/trial-pack", updateTrialPack);

import {
  getAdminOrders,
  shipOrder,
  updateOrderStatus,
  getOrderLabel,
  testDelhiveryConnection,
  resetOrderShipping,
} from "../controller/delhivery.controller";

router.get("/coupons", getCoupons);
router.get("/coupons/:id", getCouponById);
router.post("/coupons", createCoupon);
router.put("/coupons/:id", updateCoupon);
router.delete("/coupons/:id", deleteCoupon);

/* ─── Order management + Delhivery shipping ─── */
router.get("/orders", getAdminOrders);
router.post("/orders/:id/ship", shipOrder);
router.put("/orders/:id/status", updateOrderStatus);
router.get("/orders/:id/label", getOrderLabel);
router.post("/orders/:id/reset-shipping", resetOrderShipping);
router.get("/delhivery/test", testDelhiveryConnection);

export default router;
