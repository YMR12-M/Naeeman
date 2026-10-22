import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { shopService } from './shop.service.js';
import { hoursSchema, settingsSchema, updateShopSchema } from './shop.validation.js';

const router = Router();
router.use(authenticate);

/** المحل كله في طلب واحد: البيانات + القواعد + المواعيد + فاتح دلوقتي؟ */
router.get('/', requirePermission('shop.read'), asyncHandler(async (req, res) =>
  ok(res, await shopService.get(req.shopId))));

router.patch('/', requirePermission('shop.write'), validate({ body: updateShopSchema }),
  asyncHandler(async (req, res) => {
    const { before, after } = await shopService.update(req.shopId, req.body);
    await audit(req, { action: 'shop.update', entity: 'shop', entityId: req.shopId, before, after });
    ok(res, after);
  }));

router.get('/hours', requirePermission('shop.read'), asyncHandler(async (req, res) =>
  ok(res, await shopService.getHours(req.shopId))));

router.put('/hours', requirePermission('shop.write'), validate({ body: hoursSchema }),
  asyncHandler(async (req, res) => {
    const { before, after } = await shopService.replaceHours(req.shopId, req.body.periods);
    await audit(req, { action: 'shop.hours', entity: 'shop', entityId: req.shopId, before, after: after.periods });
    ok(res, after);
  }));

router.get('/settings', requirePermission('shop.read'), asyncHandler(async (req, res) =>
  ok(res, await shopService.getSettings(req.shopId))));

router.patch('/settings', requirePermission('shop.write'), validate({ body: settingsSchema }),
  asyncHandler(async (req, res) => {
    const { before, after } = await shopService.updateSettings(req.shopId, req.body);
    await audit(req, { action: 'shop.settings', entity: 'shop', entityId: req.shopId, before, after });
    ok(res, after);
  }));

export default router;
