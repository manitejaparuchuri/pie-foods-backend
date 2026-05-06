import { Router } from "express";
import {
  adminLogin,
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

router.get("/bootstrap", getAdminBootstrap);
router.get("/db/tables", getDbTables);
router.get("/db/tables/:tableName", getDbTableRows);
router.get("/apis", getApiCatalog);
router.post("/upload/image", upload.single("image"), uploadAdminImage);

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

router.get("/coupons", getCoupons);
router.get("/coupons/:id", getCouponById);
router.post("/coupons", createCoupon);
router.put("/coupons/:id", updateCoupon);
router.delete("/coupons/:id", deleteCoupon);

export default router;
