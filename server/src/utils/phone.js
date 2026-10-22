/**
 * توحيد صيغة أرقام الهاتف قبل التخزين والبحث.
 *
 *   01012345678      → +201012345678
 *   0020 101 234 5678 → +2010 1234 5678 (بلا فراغات)
 *   +44 7700 900123  → +447700900123
 *
 * بدون التوحيد يصبح البحث عن زبون برقمه مستحيلًا (نفس الرقم بثلاث صيغ).
 */
export function normalizePhone(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const hasPlus = text.startsWith('+');
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;

  if (!hasPlus && digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (hasPlus) return `+${digits}`;

  // رقم مصري محلي: 01xxxxxxxxx
  if (/^01[0125]\d{8}$/.test(digits)) return `+20${digits.slice(1)}`;
  // 20 + 10 خانات بلا علامة +
  if (/^20(10|11|12|15)\d{8}$/.test(digits)) return `+${digits}`;

  digits = digits.replace(/^0+/, '');
  return digits;
}

/** آخر n أرقام — للتحقق من هوية صاحب الحجز بدل كشف الرقم كاملًا */
export const lastDigits = (phone, count = 4) => String(phone ?? '').replace(/\D/g, '').slice(-count);
