/**
 * الاستقبال بيساعد زبون في حسابه وهو واقف قدّامه في المحل.
 * دلوقتي فيه حاجة واحدة: كود استعادة كلمة السر للزبون اللي مالوش بريد.
 * الكود بيظهر للموظف مرّة واحدة، وبيتسجّل في سجل التدقيق مين طلّعه ولمين.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { passwordResetLimiter } from '../../middleware/rateLimiters.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { audit } from '../../utils/audit.js';
import { ok } from '../../utils/response.js';
import { phoneSchema } from '../../utils/schemas.js';
import { customerAuthService } from './customerAuth.service.js';

const router = Router();
router.use(authenticate);

router.post(
  '/recovery-code',
  requirePermission('queue.write'),
  passwordResetLimiter,
  validate({ body: z.object({ phone: phoneSchema }).strict() }),
  asyncHandler(async (req, res) => {
    const result = await customerAuthService.issueShopCode(req.body.phone, req.user.id);
    await audit(req, {
      action: 'customer.recovery_code', entity: 'customer', entityId: result.customer.id,
      after: { name: result.customer.name, phone: result.customer.phone },
    });
    ok(res, result);
  }),
);

export default router;
