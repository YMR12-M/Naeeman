import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, noContent } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { usersService } from './users.service.js';

/** نُسجّل بلا كلمات مرور ولا بصمات */
const safe = (user) => (user ? {
  id: user.id, full_name: user.full_name, email: user.email, role: user.role, status: user.status,
} : null);

export const usersController = {
  list: asyncHandler(async (req, res) => ok(res, await usersService.list(req.user, req.query))),

  get: asyncHandler(async (req, res) => ok(res, await usersService.get(req.user, req.params.id))),

  create: asyncHandler(async (req, res) => {
    const result = await usersService.create(req.user, req.body);
    await audit(req, { action: 'user.create', entity: 'user', entityId: result.user.id, after: safe(result.user) });
    created(res, result);
  }),

  update: asyncHandler(async (req, res) => {
    const { before, after } = await usersService.update(req.user, req.params.id, req.body);
    await audit(req, { action: 'user.update', entity: 'user', entityId: after.id, before: safe(before), after: safe(after) });
    ok(res, after);
  }),

  remove: asyncHandler(async (req, res) => {
    const removed = await usersService.remove(req.user, req.params.id);
    await audit(req, { action: 'user.delete', entity: 'user', entityId: removed.id, before: safe(removed) });
    noContent(res);
  }),

  tempPassword: asyncHandler(async (req, res) => {
    const result = await usersService.issueTempPassword(req.user, req.params.id);
    await audit(req, { action: 'user.temp_password', entity: 'user', entityId: result.user.id });
    ok(res, { temp_password: result.temp_password });
  }),
};
