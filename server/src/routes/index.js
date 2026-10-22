import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/users/users.routes.js';
import shopRoutes from '../modules/shop/shop.routes.js';
import serviceRoutes from '../modules/services/services.routes.js';
import barberRoutes from '../modules/barbers/barbers.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import queueRoutes from '../modules/queue/queue.routes.js';
import customerAuthRoutes from '../modules/customers/customerAuth.routes.js';
import meRoutes from '../modules/customers/me.routes.js';
import publicRoutes from '../modules/public/public.routes.js';

const router = Router();

// موظفو المحل (كل مسار تحت ده بيتحقّق من الدخول والصلاحية بنفسه)
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/shop', shopRoutes);
router.use('/services', serviceRoutes);
router.use('/barbers', barberRoutes);
router.use('/audit', auditRoutes);
router.use('/queue', queueRoutes);

// الزبون (توكن بجمهور مختلف عن الموظفين)
router.use('/customer-auth', customerAuthRoutes);
router.use('/me', meRoutes);

// عام من غير حساب
router.use('/public', publicRoutes);

export default router;
