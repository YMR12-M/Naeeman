import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/users/users.routes.js';
import shopRoutes from '../modules/shop/shop.routes.js';
import serviceRoutes from '../modules/services/services.routes.js';
import barberRoutes from '../modules/barbers/barbers.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import queueRoutes from '../modules/queue/queue.routes.js';
import reportRoutes from '../modules/reports/reports.routes.js';
import customerAuthRoutes from '../modules/customers/customerAuth.routes.js';
import meRoutes from '../modules/customers/me.routes.js';
import customerSupportRoutes from '../modules/customers/customerSupport.routes.js';
import publicRoutes from '../modules/public/public.routes.js';
import deviceRoutes from '../modules/devices/devices.routes.js';
import displayRoutes from '../modules/devices/display.routes.js';
import kioskRoutes from '../modules/devices/kiosk.routes.js';
import chairRoutes from '../modules/devices/chair.routes.js';
import productRoutes from '../modules/products/products.routes.js';
import cardRoutes from '../modules/cards/cards.routes.js';
import payrollRoutes from '../modules/payroll/payroll.routes.js';
import hubRoutes from '../modules/hub/hub.routes.js';
import { billsRouter, dayCloseRouter, drawerRouter, methodsRouter } from '../modules/billing/billing.routes.js';

const router = Router();

// موظفو المحل (كل مسار تحت ده بيتحقّق من الدخول والصلاحية بنفسه)
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/shop', shopRoutes);
router.use('/services', serviceRoutes);
router.use('/barbers', barberRoutes);
router.use('/audit', auditRoutes);
router.use('/queue', queueRoutes);
router.use('/reports', reportRoutes);
// المرحلة التانية: الكاشير والمخزن والحساب والكروت
router.use('/bills', billsRouter);
router.use('/payment-methods', methodsRouter);
router.use('/drawer', drawerRouter);
router.use('/day-close', dayCloseRouter);
router.use('/products', productRoutes);
router.use('/payroll', payrollRoutes);
router.use('/cards', cardRoutes);
router.use('/hub', hubRoutes);

// الزبون (توكن بجمهور مختلف عن الموظفين)
router.use('/customer-auth', customerAuthRoutes);
router.use('/me', meRoutes);
router.use('/customers', customerSupportRoutes);

// أجهزة المحل (ربطها بكود، وبعدها ترويسة X-Device-Token)
router.use('/devices', deviceRoutes);
router.use('/display', displayRoutes);
router.use('/kiosk', kioskRoutes);
router.use('/chair', chairRoutes);

// عام من غير حساب
router.use('/public', publicRoutes);

export default router;
