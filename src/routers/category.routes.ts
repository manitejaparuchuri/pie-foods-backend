import { Router } from "express";
import{getAll, getById, getProductsByCategory, getCategoriesWithProducts} from '../controller/category.controller';

const router = Router();
router.get('/', getAll);
router.get('/with-products/all', getCategoriesWithProducts);
router.get('/:id/products', getProductsByCategory);
router.get('/:id', getById);



export default router;
