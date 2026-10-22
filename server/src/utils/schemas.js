/**
 * ═══════════════════════════════════════════════════════════════
 *  لبنات سكيما Zod المشتركة
 *
 *  قاعدة: لا transform يحوّل undefined إلى null هنا — وإلا فكل PATCH
 *  كان سيمسح الحقول التي لم يُرسلها العميل. النصّ الفارغ فقط يتحوّل
 *  إلى null، والحقل الغائب يبقى غائبًا.
 * ═══════════════════════════════════════════════════════════════
 */
import { z } from 'zod';
import '../config/zod.js';
import { isValidIso } from './dates.js';
import { normalizePhone } from './phone.js';
import { passwordIssues } from './security.js';

export const idSchema = z.coerce.number().int().positive();

/** idParams('propertyId', 'id') ← سكيما لـ req.params */
export const idParams = (...names) =>
  z.object(Object.fromEntries((names.length ? names : ['id']).map((name) => [name, idSchema])));

export const isoDate = z.string().refine(isValidIso, 'التاريخ لازم بصيغة YYYY-MM-DD وصالح');

/** المبالغ بالقروش — أعداد صحيحة (حدّ أعلى معقول لخدمة حلاقة: 100 ألف جنيه) */
export const minorAmount = z.number().int('المبلغ بالقروش — عدد صحيح').min(0).max(10_000_000);

export const emailSchema = z.string().trim().toLowerCase().email().max(190);

export const phoneSchema = z.string().trim().min(7).max(30)
  .transform((value) => normalizePhone(value))
  .refine((value) => value && value.replace(/\D/g, '').length >= 7, 'رقم هاتف غير صالح');

export const passwordSchema = z.string().max(128).superRefine((value, ctx) => {
  const issues = passwordIssues(value);
  if (issues.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `كلمة المرور لازم: ${issues.join('، ')}` });
  }
});

/**
 * كلمة سر الزبون: أخفّ من الموظفين (حسابه شايل أدواره بس)، لكن مش ضعيفة.
 * 8 حروف على الأقل، ومش من الشائعة، ومش حرف مكرّر.
 */
export const customerPasswordSchema = z.string().max(128).superRefine((value, ctx) => {
  const issues = [];
  if (value.length < 8) issues.push('8 حروف على الأقل');
  if (/^(.)\1+$/.test(value)) issues.push('مش حرف واحد مكرّر');
  if (/^(0123456789|123456789|12345678|password|qwertyui)/i.test(value)) issues.push('مش من كلمات السر الشائعة');
  if (issues.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `كلمة السر لازم: ${issues.join('، ')}` });
  }
});

export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'الوقت بصيغة HH:MM');

/** نصّ اختياري: الفارغ ← null، والغائب يبقى غائبًا */
export const optionalText = (max = 500) =>
  z.string().trim().max(max).transform((value) => (value === '' ? null : value)).nullish();

export const requiredText = (max = 190) => z.string().trim().min(1).max(max);

export const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

/** قيمة منطقية قادمة من query string ("true" / "1") أو JSON */
export const boolish = z.union([
  z.boolean(),
  z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1'),
]);

/** مدى تواريخ: to بعد from */
export const dateRangeRefine = (data) => !data.from || !data.to || data.to >= data.from;

/** PIN الحلاق: 4 أرقام بالظبط */
export const pinSchema = z.string().regex(/^\d{4}$/, 'الـ PIN لازم 4 أرقام');

/** اسم المحل في الرابط: حروف إنجليزي صغيرة وأرقام وشرطة */
export const slugSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'حروف إنجليزي صغيرة وأرقام وشرطة بس')
  .min(3).max(40);
