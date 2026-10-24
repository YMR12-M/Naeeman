/** «next» بعد الدخول: مسار جوّه التطبيق بس (مش رابط برّه، ولا //دومين تاني) */
export const safeNext = (next) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
