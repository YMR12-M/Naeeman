/**
 * يغلّف معالجًا غير متزامن بحيث يصل أي رفض (rejection) إلى معالج الأخطاء
 * المركزي بدل أن يتحوّل إلى unhandledRejection يُسقط العملية.
 */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
