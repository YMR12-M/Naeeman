/**
 * التحقّق من صحّة المدخلات باستخدام Zod.
 *
 * نمرّر سكيما لكل مصدر (params / query / body)، وعند الفشل نُرجع 422
 * مع أخطاء الحقول ليعرضها الفورم مباشرة أمام كل حقل.
 * وعند النجاح نستبدل المدخلات بالنسخة المُنظّفة (تحويل أنواع، قصّ حقول زائدة).
 *
 * @example
 *   router.post('/', validate({ body: createSchema }), controller.create)
 */
import { ApiError } from '../utils/ApiError.js';

export const validate = (schemas) => (req, _res, next) => {
  const fieldErrors = {};

  for (const source of ['params', 'query', 'body']) {
    const schema = schemas[source];
    if (!schema) continue;

    const result = schema.safeParse(req[source] ?? {});
    if (result.success) {
      // params: ندمج بدل الاستبدال كي لا نفقد معاملات الراوتر الأب
      req[source] = source === 'params' ? { ...req.params, ...result.data } : result.data;
      continue;
    }

    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || source;
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return next(ApiError.unprocessable('تحقّق من البيانات المُدخلة', {
      code: 'VALIDATION_ERROR',
      details: fieldErrors,
    }));
  }
  return next();
};
