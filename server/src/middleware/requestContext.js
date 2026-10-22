/**
 * معرّف لكل طلب + سياقه (IP، المتصفّح، نوع العميل).
 *
 * المعرّف يظهر في ترويسة الاستجابة `X-Request-Id` وفي لوجات الأخطاء،
 * فلما يشتكي مستخدم من خطأ نصل لسطره في اللوج مباشرة.
 *
 * نوع العميل (`X-Client-Type`): web | mobile | desktop. التطبيقات لا تعتمد على
 * الكوكيز (WebView أو Electron)، فتستلم توكن التجديد في الجسم وتخزّنه آمنًا.
 */
import crypto from 'node:crypto';

const CLIENT_TYPES = new Set(['web', 'mobile', 'desktop']);

export function requestContext(req, res, next) {
  const incoming = String(req.headers['x-request-id'] || '').slice(0, 64);
  req.id = /^[\w.-]+$/.test(incoming) && incoming ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);

  const clientType = String(req.headers['x-client-type'] || 'web').toLowerCase();
  req.context = {
    ip: req.ip,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255),
    clientType: CLIENT_TYPES.has(clientType) ? clientType : 'web',
  };
  next();
}
