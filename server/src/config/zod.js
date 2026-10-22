/**
 * رسائل Zod بالعربية.
 *
 * Zod يُرجع افتراضيًا رسائل إنجليزية ("Required"، "Expected number")،
 * والفورم يعرضها أمام الحقل كما هي. نستبدلها هنا مرّة واحدة لكل المشروع،
 * وأي سكيما تحدّد رسالتها بنفسها (مثل «بريد إلكتروني غير صالح») تظلّ فوق هذه.
 */
import { z } from 'zod';

const TYPE_NAMES = {
  string: 'نص', number: 'رقم', boolean: 'نعم/لا', array: 'قائمة', object: 'كائن', date: 'تاريخ',
};

const errorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'الحقل مطلوب' };
      return { message: `نوع القيمة غير صحيح (المطلوب: ${TYPE_NAMES[issue.expected] ?? issue.expected})` };

    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return { message: issue.minimum <= 1 ? 'الحقل مطلوب' : `لازم ${issue.minimum} حروف على الأقل` };
      }
      if (issue.type === 'number') return { message: `القيمة لازم تكون ${issue.inclusive ? 'أكبر من أو تساوي' : 'أكبر من'} ${issue.minimum}` };
      if (issue.type === 'array') return { message: `لازم ${issue.minimum} عناصر على الأقل` };
      break;

    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `الحدّ الأقصى ${issue.maximum} حرفًا` };
      if (issue.type === 'number') return { message: `القيمة لازم تكون ${issue.inclusive ? 'أقل من أو تساوي' : 'أقل من'} ${issue.maximum}` };
      if (issue.type === 'array') return { message: `الحدّ الأقصى ${issue.maximum} عناصر` };
      break;

    case z.ZodIssueCode.invalid_enum_value:
      return { message: `القيمة غير مسموحة (المسموح: ${issue.options.join('، ')})` };

    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'بريد إلكتروني غير صالح' };
      if (issue.validation === 'url') return { message: 'رابط غير صالح' };
      return { message: 'الصيغة غير صحيحة' };

    case z.ZodIssueCode.unrecognized_keys:
      return { message: `حقول غير معروفة: ${issue.keys.join('، ')}` };

    default:
      break;
  }
  return { message: ctx.defaultError };
};

z.setErrorMap(errorMap);
