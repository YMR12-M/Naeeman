/**
 * التفويض: هل يملك المستخدم الصلاحية؟ (التوثيق «من أنت» في authenticate،
 * والتفويض «ماذا تستطيع» هنا.)
 *
 * @example
 *   router.post('/', requirePermission('reservations.write'), controller.create)
 *   router.get('/',  requireAnyPermission('billing.read', 'reports.read'), controller.list)
 */
import { ApiError } from '../utils/ApiError.js';
import { can } from '../config/permissions.js';

const deny = () => ApiError.forbidden('لا تملك صلاحية لهذا الإجراء', { code: 'FORBIDDEN' });

/** كل الصلاحيات المذكورة مطلوبة */
export const requirePermission = (...permissions) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  return permissions.every((permission) => can(req.user.role, permission)) ? next() : next(deny());
};

/** أيّ صلاحية من المذكورة تكفي */
export const requireAnyPermission = (...permissions) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  return permissions.some((permission) => can(req.user.role, permission)) ? next() : next(deny());
};

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  return roles.includes(req.user.role) ? next() : next(deny());
};
