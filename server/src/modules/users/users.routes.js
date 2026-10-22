import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { idParams } from '../../utils/schemas.js';
import { usersController as c } from './users.controller.js';
import { createUserSchema, updateUserSchema, listUsersQuery } from './users.validation.js';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('users.read'), validate({ query: listUsersQuery }), c.list);
router.post('/', requirePermission('users.write'), validate({ body: createUserSchema }), c.create);
router.get('/:id', requirePermission('users.read'), validate({ params: idParams('id') }), c.get);
router.patch('/:id', requirePermission('users.write'), validate({ params: idParams('id'), body: updateUserSchema }), c.update);
router.delete('/:id', requirePermission('users.write'), validate({ params: idParams('id') }), c.remove);
router.post('/:id/temp-password', requirePermission('users.write'), validate({ params: idParams('id') }), c.tempPassword);

export default router;
