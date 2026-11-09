/**
 * كروت الزباين للموظفين: بحث، وكارت كامل، وملاحظات، وأختام، وصور، و«وحشونا».
 * الصور بتترفع كملف خام (Content-Type: image/jpeg…) مش JSON، وبتتقري بتوكن.
 */
import express, { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent, paged } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { MAX_PHOTO_BYTES } from '../../utils/storage.js';
import { idParams, idSchema, optionalText, pagingSchema, requiredText } from '../../utils/schemas.js';
import { addPhoto, cardsService as service, deletePhoto, photoFile } from './cards.service.js';

export const rawImage = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_PHOTO_BYTES });

export function sendImage(res, { buffer, mime }) {
  res.set('Content-Type', mime);
  res.set('Cache-Control', 'private, max-age=604800, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(buffer);
}

const updateBody = z.object({
  name: requiredText(60),
  notes: optionalText(1000),
  reminders_off: z.boolean(),
}).partial().strict();

const stampsBody = z.object({
  delta: z.number().int().min(-50).max(50).refine((value) => value !== 0, 'التعديل مينفعش يبقى صفر'),
  note: requiredText(190),
}).strict();

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('cards.read'), validate({ query: pagingSchema.extend({ q: z.string().trim().max(60).optional() }) }),
  asyncHandler(async (req, res) => {
    const { rows, meta } = await service.list(req.shopId, { q: req.query.q || undefined, page: req.query.page, pageSize: req.query.page_size });
    paged(res, rows, meta);
  }));

router.get('/reminders', requirePermission('cards.read'), asyncHandler(async (req, res) =>
  ok(res, await service.dueReminders(req.shopId))));

router.get('/:id', requirePermission('cards.read'), validate({ params: idParams('id') }), asyncHandler(async (req, res) =>
  ok(res, await service.get(req.shopId, req.params.id))));

router.patch('/:id', requirePermission('cards.write'), validate({ params: idParams('id'), body: updateBody }),
  asyncHandler(async (req, res) => {
    const { before, after } = await service.update(req.shopId, req.params.id, req.body);
    await audit(req, { action: 'card.update', entity: 'card', entityId: after.id, before, after });
    ok(res, after);
  }));

router.post('/:id/stamps', requirePermission('cards.stamps'), validate({ params: idParams('id'), body: stampsBody }),
  asyncHandler(async (req, res) => {
    const result = await service.adjustStamps(req.shopId, req.params.id, req.body.delta, req.body.note, req.user.id);
    await audit(req, { action: 'card.stamps', entity: 'card', entityId: req.params.id, after: { ...req.body, stamps: result.stamps } });
    ok(res, result);
  }));

router.post('/:id/reminded', requirePermission('cards.write'), validate({ params: idParams('id') }), asyncHandler(async (req, res) =>
  ok(res, await service.markReminded(req.shopId, req.params.id))));

router.get('/:id/photos/:photoId', requirePermission('cards.read'), validate({ params: idParams('id', 'photoId') }),
  asyncHandler(async (req, res) => sendImage(res, await photoFile(req.shopId, req.params.photoId, { cardId: req.params.id }))));

router.post('/:id/photos', requirePermission('cards.write'), rawImage,
  validate({ params: idParams('id'), query: z.object({ ticket_id: idSchema.optional() }) }),
  asyncHandler(async (req, res) => {
    const photo = await addPhoto(req.shopId, req.params.id, req.body, {
      ticketId: req.query.ticket_id ?? null, takenBy: 'staff', takenById: req.user.id,
    });
    created(res, photo);
  }));

router.delete('/:id/photos/:photoId', requirePermission('cards.write'), validate({ params: idParams('id', 'photoId') }),
  asyncHandler(async (req, res) => {
    const removed = await deletePhoto(req.shopId, req.params.photoId, 'staff');
    await audit(req, { action: 'card.photo_delete', entity: 'card', entityId: removed.shop_customer_id, before: { photo_id: removed.id } });
    noContent(res);
  }));

export default router;
