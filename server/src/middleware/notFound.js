import { ApiError } from '../utils/ApiError.js';

/** أي مسار لم يطابقه شيء */
export const notFound = (_req, _res, next) =>
  next(ApiError.notFound('المسار غير موجود', { code: 'ROUTE_NOT_FOUND' }));
