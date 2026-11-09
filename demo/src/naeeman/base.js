/* ============================================
   نعيمًا التجريبي - أدوات مشتركة

   الجداول كلها مصفوفات جوّه db (localStorage الزائر). التواريخ والأوقات
   نصوص ISO زي ما السيرفر بيرجّعها في JSON، و business_date نص YYYY-MM-DD.
   الفلوس بالقروش. المنطق الصافي (الطابور والمواعيد والصلاحيات) مستورد
   من كود السيرفر نفسه، فالأرقام هنا هي نفس أرقام السيرفر.
   ============================================ */
import { ApiError } from '../../../server/src/utils/ApiError.js';
import { businessDateAt, shopStatusAt } from '../../../server/src/utils/hours.js';
import { normalizePhone } from '../../../server/src/utils/phone.js';
import { permissionsOf } from '../../../server/src/config/permissions.js';

export { ApiError, normalizePhone, permissionsOf };

export const MINUTE = 60_000;
export const DAY = 86_400_000;

export const nowIso = (ms) => new Date(ms === undefined ? Date.now() : ms).toISOString();
export const toDate = (value) => (value ? new Date(value) : null);
export const minutesAgo = (m) => nowIso(Date.now() - m * MINUTE);
export const minutesFromNow = (m) => nowIso(Date.now() + m * MINUTE);

/** صفّ جديد برقم متسلسل */
export function insert(db, table, row) {
  const id = (db.seq[table] = (db.seq[table] || 0) + 1);
  const full = Object.assign({ id }, row);
  db[table].push(full);
  return full;
}

export const byId = (rows, id) => rows.find((row) => row.id === Number(id)) || null;

export function counter(db, name) {
  db.counters[name] = (db.counters[name] || 0) + 1;
  return db.counters[name];
}

/* ---------- المحل والمواعيد ---------- */

export const shopOf = (db) => db.shop;
export const settingsOf = (db) => db.settings;

export function openState(db, now = new Date()) {
  const status = shopStatusAt(db.hours, db.shop.timezone, now);
  return { open: status.open, business_date: status.businessDate, closes_at: status.closesAt, next_opens_at: status.nextOpensAt };
}

export const todayOf = (db, now = new Date()) => businessDateAt(db.hours, db.shop.timezone, now);

/* ---------- التحقّق ---------- */

export const invalid = (errors, message) =>
  ApiError.unprocessable(message || 'تحقّق من البيانات المُدخلة', { code: 'VALIDATION_ERROR', details: errors });

/** يجمع أخطاء الحقول ويرمي 422 لو فيه */
export function check(errors) {
  const clean = {};
  Object.keys(errors).forEach((key) => {
    if (errors[key]) clean[key] = errors[key];
  });
  if (Object.keys(clean).length) throw invalid(clean);
}

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export const V = {
  text(v, { required = false, max = 190, min = 1 } = {}) {
    if (blank(v)) return required ? 'الحقل مطلوب' : null;
    if (typeof v !== 'string') return 'نوع القيمة غير صحيح';
    if (v.trim().length < min) return `لازم ${min} حروف على الأقل`;
    return v.trim().length > max ? `الحدّ الأقصى ${max} حرفًا` : null;
  },
  money(v, { required = false, positive = false } = {}) {
    if (v === undefined || v === null) return required ? 'الحقل مطلوب' : null;
    if (typeof v !== 'number' || !Number.isInteger(v)) return 'المبلغ بالقروش — عدد صحيح';
    if (v < 0) return 'القيمة لازم تكون أكبر من أو تساوي 0';
    if (positive && v === 0) return 'المبلغ لازم أكبر من صفر';
    return v > 10_000_000 ? 'القيمة لازم تكون أقل من أو تساوي 10000000' : null;
  },
  int(v, { required = false, min = -Infinity, max = Infinity } = {}) {
    if (v === undefined || v === null) return required ? 'الحقل مطلوب' : null;
    if (typeof v !== 'number' || !Number.isInteger(v)) return 'لازم رقم صحيح';
    if (v < min) return `القيمة لازم تكون أكبر من أو تساوي ${min}`;
    return v > max ? `القيمة لازم تكون أقل من أو تساوي ${max}` : null;
  },
  phone(v, { required = false } = {}) {
    if (blank(v)) return required ? 'الحقل مطلوب' : null;
    const p = normalizePhone(v);
    return p && p.replace(/\D/g, '').length >= 7 ? null : 'رقم هاتف غير صالح';
  },
  email(v, { required = false } = {}) {
    if (blank(v)) return required ? 'الحقل مطلوب' : null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) ? null : 'بريد إلكتروني غير صالح';
  },
  oneOf(v, list, { required = false } = {}) {
    if (blank(v)) return required ? 'الحقل مطلوب' : null;
    return list.includes(v) ? null : 'قيمة غير مسموحة';
  },
  date(v, { required = false } = {}) {
    if (blank(v)) return required ? 'الحقل مطلوب' : null;
    return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) ? null : 'التاريخ لازم بصيغة YYYY-MM-DD وصالح';
  },
};

export const optText = (v) => (blank(v) ? null : String(v).trim());
export const phoneOrNull = (v) => (blank(v) ? null : normalizePhone(v));

export function customerPasswordIssue(value) {
  const issues = [];
  value = String(value || '');
  if (value.length < 8) issues.push('8 حروف على الأقل');
  if (/^(.)\1+$/.test(value)) issues.push('مش حرف واحد مكرّر');
  if (/^(0123456789|123456789|12345678|password|qwertyui)/i.test(value)) issues.push('مش من كلمات السر الشائعة');
  return issues.length ? `كلمة السر لازم: ${issues.join('، ')}` : null;
}

export function staffPasswordIssue(value) {
  const issues = [];
  value = String(value || '');
  if (value.length < 10) issues.push('10 حروف على الأقل');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((p) => p.test(value)).length;
  if (classes < 2 && value.length < 16) issues.push('تجمع نوعين على الأقل: حروف، أرقام، رموز (أو تكون 16 حرفًا فأكثر)');
  if (/^(.)\1+$/.test(value)) issues.push('ليست حرفًا مكرّرًا');
  return issues.length ? `كلمة المرور لازم: ${issues.join('، ')}` : null;
}

export function pageOf(query, size = 25) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || size));
  return { page, pageSize };
}

/* ---------- السجل ---------- */

export function audit(db, user, action, entity, entityId, before, after) {
  insert(db, 'audit', {
    action, entity, entity_id: entityId ?? null,
    before_json: before === undefined ? null : before,
    after_json: after === undefined ? null : after,
    ip: '127.0.0.1',
    created_at: nowIso(),
    user_id: user ? user.id : null,
  });
  if (db.audit.length > 400) db.audit.splice(0, db.audit.length - 400);
}

/* ---------- الصور الوهمية (SVG صغير بدل صورة القصّة) ---------- */

const HUES = [18, 32, 160, 200, 260, 340];
export function photoSvg(seed, label) {
  const hue = HUES[seed % HUES.length];
  const fade = 30 + (seed % 5) * 6;
  const text = String(label || 'نعيمًا').replace(/[<&>]/g, '');
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600" viewBox="0 0 480 600">' +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 35% ${fade + 30}%)"/>` +
    `<stop offset="1" stop-color="hsl(${hue} 40% ${fade}%)"/></linearGradient></defs>` +
    '<rect width="480" height="600" fill="url(#g)"/>' +
    `<ellipse cx="240" cy="270" rx="120" ry="150" fill="hsl(${hue} 20% 82%)"/>` +
    `<path d="M120 250 Q130 110 240 100 Q350 110 360 250 Q330 ${150 + (seed % 4) * 12} 240 150 Q150 ${150 + (seed % 3) * 14} 120 250Z" fill="hsl(${hue} 30% 16%)"/>` +
    '<rect x="70" y="440" width="340" height="200" rx="120" fill="hsl(0 0% 12%)"/>' +
    `<text x="240" y="560" font-family="sans-serif" font-size="30" fill="#fff" text-anchor="middle">${text}</text>` +
    '</svg>'
  );
}

export function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function photoBlob(photo) {
  if (photo.data) return dataUrlToBlob(photo.data);
  return new Blob([photoSvg(photo.art || photo.id, photo.label)], { type: 'image/svg+xml' });
}
