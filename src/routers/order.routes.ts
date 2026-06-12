import { Router } from 'express';
import { createOrder, getMyOrders, getOrderById } from '../controller/order.controller';
import { trackOrder } from '../controller/delhivery.controller';
import { verifyToken } from '../middlewares/auth';

const router = Router();

router.post('/', verifyToken, createOrder);
router.get('/my', verifyToken, getMyOrders);
// Order tracking — pulls live status from Delhivery when waybill exists.
// Keep BEFORE /:id so the literal "track" segment is not captured as an id.
router.get('/:id/track', verifyToken, trackOrder);
// Single-order fetch — owner-only (admins always allowed). Keep AFTER /my so
// the literal route wins over the :id param.
router.get('/:id', verifyToken, getOrderById);

export default router;
