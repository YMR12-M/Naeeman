/**
 * خطأ تطبيقي يحمل كود HTTP ورسالة صالحة للعرض للمستخدم.
 * أي خطأ من هذا النوع يُرسَل كما هو للعميل؛ وأي خطأ آخر يُعتبر
 * خطأ داخليًا غير متوقّع ويُخفى تفصيله في الإنتاج.
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode كود حالة HTTP
   * @param {string} message رسالة عربية موجّهة للمستخدم
   * @param {object} [options]
   * @param {string} [options.code] كود داخلي للواجهة (مثل ROOM_TAKEN)
   * @param {object} [options.details] تفاصيل إضافية (أخطاء الحقول مثلًا)
   */
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code || null;
    this.details = details || null;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'طلب غير صالح', options) { return new ApiError(400, message, options); }
  static unauthorized(message = 'تسجيل الدخول مطلوب', options) { return new ApiError(401, message, options); }
  static forbidden(message = 'لا تملك صلاحية لهذا الإجراء', options) { return new ApiError(403, message, options); }
  static notFound(message = 'العنصر المطلوب غير موجود', options) { return new ApiError(404, message, options); }
  static conflict(message = 'تعارض مع بيانات موجودة', options) { return new ApiError(409, message, options); }
  static payloadTooLarge(message = 'الملف أكبر من الحدّ المسموح', options) { return new ApiError(413, message, options); }
  static unprocessable(message = 'بيانات غير مكتملة', options) { return new ApiError(422, message, options); }
  static locked(message = 'الحساب مقفول مؤقتًا', options) { return new ApiError(423, message, options); }
  static tooMany(message = 'محاولات كثيرة، انتظر قليلًا', options) { return new ApiError(429, message, options); }
  static internal(message = 'حدث خطأ غير متوقّع', options) { return new ApiError(500, message, options); }
  /** خطأ من خدمة خارجية (بريد، بوابة دفع) — ليس خطأ العميل */
  static badGateway(message = 'خدمة خارجية غير متاحة حاليًا', options) { return new ApiError(502, message, options); }
  static unavailable(message = 'الخدمة غير متاحة مؤقتًا', options) { return new ApiError(503, message, options); }
}
