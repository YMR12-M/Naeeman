import { useCallback, useState } from 'react';
import { ApiRequestError } from './api.js';

/**
 * حالة نموذج بسيطة: قيم + أخطاء حقول قادمة من السيرفر.
 *   const form = useForm({ name: '' });
 *   <Input value={form.values.name} onChange={form.on('name')} />
 *   <Field error={form.errors.name} …>
 *   catch (e) { form.fail(e) }   ← يضع أخطاء الحقول (VALIDATION_ERROR) ويعيد رسالة عامة للتنبيه
 */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});

  const set = useCallback((key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }, []);
  /** معالج onChange لحقل نصّي */
  const on = useCallback((key) => (event) => set(key, event.target.type === 'checkbox' ? event.target.checked : event.target.value), [set]);
  const reset = useCallback((next = initial) => { setValues(next); setErrors({}); }, [initial]);

  /** يُرجع رسالة عامة (أو null لو كل الخطأ موزَّع على حقول) */
  const fail = useCallback((error) => {
    if (error instanceof ApiRequestError && error.errors && typeof error.errors === 'object' && !Array.isArray(error.errors)) {
      const fields = Object.fromEntries(Object.entries(error.errors).filter(([, value]) => typeof value === 'string'));
      if (Object.keys(fields).length > 0) { setErrors(fields); return error.code === 'VALIDATION_ERROR' ? null : error.message; }
    }
    setErrors({});
    return error?.message ?? 'حصل خطأ غير متوقّع';
  }, []);

  return { values, errors, set, on, setValues, setErrors, reset, fail };
}

/** نص رسالة مناسبة من أي خطأ */
export const errorMessage = (error) => error?.message ?? 'حصل خطأ غير متوقّع';
