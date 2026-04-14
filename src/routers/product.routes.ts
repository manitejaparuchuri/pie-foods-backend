import { Router } from 'express';
import {
  getAll,
  getByCategory,
  getById,
  
} from '../controller/product.controller';

const router = Router();

// FIRST: exact routes
router.get('/', getAll);

// THEN: specific named routes
router.get('/category/:categoryId', getByCategory);

// LAST: dynamic route
router.get('/:id', getById);

export default router;
