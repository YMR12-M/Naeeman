/**
 * معالج الأخطاء المركزي — آخر middleware في السلسلة.
 *
 * المبدأ: أي ApiError يُعرض كما هو للعميل (رسائل عربية مفهومة)،
 * وأي خطأ آخر يُسجَّل كاملًا في السيرفر ويُعرض للعميل برسالة عامة
 * حتى لا نسرّب تفاصيل داخلية أو أسماء جداول.
 */
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/** ترجمة أخطاء MySQL الشائعة إلى رسائل مفهومة */
function translateDbError(error) {
  switch (error.code) {
    case 'ER_DUP_ENTRY':
      return ApiError.conflict('البيانات دي مسجّلة بالفعل', { code: 'DUPLICATE' });
    case 'ER_NO_REFERENCED_ROW_2':
    case 'ER_NO_REFERENCED_ROW':
      return ApiError.badRequest('عنصر مرتبط غير موجود', { code: 'FK_MISSING' });
    case 'ER_ROW_IS_REFERENCED_2':
    case 'ER_ROW_IS_REFERENCED':
      return ApiError.conflict('مينفعش الحذف — العنصر مستخدم في سجلات أخرى', { code: 'FK_IN_USE' });
    case 'ER_LOCK_DEADLOCK':
    case 'ER_LOCK_WAIT_TIMEOUT':
      return ApiError.conflict('العملية اتعارضت مع عملية تانية في نفس اللحظة — حاول تاني', { code: 'RETRY' });
    case 'ER_DATA_TOO_LONG':
      return ApiError.badRequest('قيمة أطول من المسموح', { code: 'DATA_TOO_LONG' });
    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
      return ApiError.unavailable('قاعدة البيانات غير متاحة حاليًا', { code: 'DB_DOWN' });
    default:
      return null;
  }
}

/** أخطاء المكتبات (body-parser، CORS) */
function translateLibraryError(error) {
  if (error.type === 'entity.parse.failed') return ApiError.badRequest('JSON غير صالح', { code: 'BAD_JSON' });
  if (error.type === 'entity.too.large') return ApiError.payloadTooLarge('حجم الطلب أكبر من المسموح');
  if (error.message === 'CORS_NOT_ALLOWED') return ApiError.forbidden('نطاق غير مسموح', { code: 'CORS' });
  return null;
}

// eslint-disable-next-line no-unused-vars -- توقيع Express يتطلّب أربعة معاملات
export function errorHandler(error, req, res, _next) {
  let apiError = error instanceof ApiError
    ? error
    : (translateLibraryError(error) || translateDbError(error));

  if (!apiError) {
    logger.error(`[${req.id}] ${req.method} ${req.originalUrl} — ${error.message}`);
    if (!env.isProd && !env.isTest) console.error(error.stack);
    apiError = ApiError.internal();
  } else if (apiError.statusCode >= 500) {
    logger.error(`[${req.id}] ${req.method} ${req.originalUrl} — ${apiError.message}`);
  }

  res.status(apiError.statusCode).json({
    success: false,
    message: apiError.message,
    code: apiError.code,
    ...(apiError.details ? { errors: apiError.details } : {}),
    ...(env.isProd ? {} : { path: req.originalUrl }),
  });
}
