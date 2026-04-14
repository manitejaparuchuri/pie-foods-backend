import { Router } from 'express';
import { createOrder, getMyOrders } from '../controller/order.controller';
import { verifyToken } from '../middlewares/auth';

const router = Router();

router.post('/', verifyToken, createOrder);
router.get('/my', verifyToken, getMyOrders);

export default router;
