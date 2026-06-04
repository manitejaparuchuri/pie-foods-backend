import { Router } from 'express';
import { createOrder, getMyOrders, getOrderById } from '../controller/order.controller';
import { verifyToken } from '../middlewares/auth';

const router = Router();

router.post('/', verifyToken, createOrder);
router.get('/my', verifyToken, getMyOrders);
// Single-order fetch — owner-only (admins always allowed). Keep AFTER /my so
// the literal route wins over the :id param.
router.get('/:id', verifyToken, getOrderById);

export default router;
