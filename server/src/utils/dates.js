/**
 * ═══════════════════════════════════════════════════════════════
 *  التواريخ بلا منطقة زمنية
 *
 *  «يوم الشغل» تاريخ تقويمي (`2026-10-22`) لا لحظة زمنية، وبنخزّنه
 *  ونمرّره نصّ ISO ونحسب عليه بحساب UTC فقط. اللي بيعتمد على منطقة
 *  زمنية هو `todayIn(tz)` و`zonedToUtc()`، وبتتمرّر لهم منطقة المحل صراحةً.
 * ═══════════════════════════════════════════════════════════════
 */
const MS_DAY = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export const parseIso = (iso) => new Date(`${iso}T00:00:00Z`);
export const toIso = (date) => date.toISOString().slice(0, 10);

/** تاريخ صالح فعلًا (يرفض 2026-02-31) */
export function isValidIso(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const date = parseIso(value);
  return !Number.isNaN(date.getTime()) && toIso(date) === value;
}

export const addDays = (iso, days) => toIso(new Date(parseIso(iso).getTime() + days * MS_DAY));

/** عدد الأيام من a إلى b (موجب لو b بعد a) */
export const diffDays = (a, b) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / MS_DAY);

/** 0 = الأحد … 6 = السبت */
export const dayOfWeek = (iso) => parseIso(iso).getUTCDay();

/** "اليوم" كما هو في منطقة زمنية محدّدة (صيغة YYYY-MM-DD) */
export function todayIn(timeZone = 'Africa/Cairo', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** فرق التوقيت (ميلي ثانية) بين منطقة زمنية و UTC عند لحظة معيّنة */
function zoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(+value.year, +value.month - 1, +value.day, +value.hour, +value.minute, +value.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * لحظة UTC المقابلة لتاريخ ووقت «على جدار» منطقة زمنية معيّنة.
 * مثال: ('2026-07-14', '14:00', 'Africa/Cairo') ← 11:00Z صيفًا و12:00Z شتاءً.
 * نصحّح مرتين لنصيب حدود التوقيت الصيفي.
 */
export function zonedToUtc(dateIso, time, timeZone) {
  const [year, month, day] = dateIso.split('-').map(Number);
  const [hours, minutes = 0, seconds = 0] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  let utc = wall - zoneOffsetMs(new Date(wall), timeZone);
  utc = wall - zoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/** حدود يوم تقويمي في منطقة زمنية كلحظات UTC: [بداية، نهاية) */
export function dayBoundsUtc(dateIso, timeZone) {
  return { start: zonedToUtc(dateIso, '00:00:00', timeZone), end: zonedToUtc(addDays(dateIso, 1), '00:00:00', timeZone) };
}
