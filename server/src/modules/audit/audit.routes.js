import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { paged, pageMeta } from '../../utils/response.js';
import { idSchema, isoDate, pagingSchema } from '../../utils/schemas.js';
import { query, queryOne, safeInt } from '../../config/db.js';

const router = Router();
router.use(authenticate);

const listQuery = pagingSchema.extend({
  entity: z.string().trim().max(40).optional(),
  entity_id: idSchema.optional(),
  action: z.string().trim().max(60).optional(),
  user_id: idSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/** سجل التدقيق للمحل: مَن غيّر ماذا ومتى (قبل/بعد) */
router.get('/', requirePermission('audit.read'), validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { page, page_size: pageSize, entity, entity_id: entityId, action, user_id: userId, from, to } = req.query;
    const where = ['a.shop_id = ?'];
    const params = [req.shopId];
    if (entity) { where.push('a.entity = ?'); params.push(entity); }
    if (entityId) { where.push('a.entity_id = ?'); params.push(entityId); }
    if (action) { where.push('a.action LIKE ?'); params.push(`${action}%`); }
    if (userId) { where.push('a.user_id = ?'); params.push(userId); }
    if (from) { where.push('a.created_at >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('a.created_at <= ?'); params.push(`${to} 23:59:59`); }

    const total = (await queryOne(`SELECT COUNT(*) AS n FROM audit_logs a WHERE ${where.join(' AND ')}`, params)).n;
    const rows = await query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.before_json, a.after_json, a.ip, a.created_at,
              u.full_name AS user_name, u.role AS user_role
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE ${where.join(' AND ')} ORDER BY a.id DESC
        LIMIT ${safeInt(pageSize, { min: 1, max: 100, fallback: 25 })} OFFSET ${safeInt((page - 1) * pageSize)}`,
      params,
    );
    paged(res, rows, pageMeta(page, pageSize, total));
  }));

export default router;
