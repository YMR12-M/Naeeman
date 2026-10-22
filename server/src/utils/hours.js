/**
 * ═══════════════════════════════════════════════════════════════
 *  مواعيد المحل: فاتح دلوقتي؟ ويوم الشغل كام؟
 *
 *  محلات الحلاقة كتير منها بيقفل بعد نص الليل (مثلًا 2 بالليل). الفترة
 *  دي بتتحسب على اليوم اللي بدأت فيه: الساعة 1 بالليل يوم السبت لسه
 *  «يوم شغل» الجمعة، وأرقام الأدوار ما بتبدأش من 1 في نص الوردية.
 *
 *  شكل الفترة: { weekday: 0..6 (0 = الأحد), opens_at: 'HH:MM[:SS]', closes_at }
 *    closes_at >  opens_at ← نفس اليوم
 *    closes_at <  opens_at ← بيقفل اليوم اللي بعده
 *    closes_at == opens_at ← فاتح 24 ساعة
 * ═══════════════════════════════════════════════════════════════
 */
import { addDays, dayOfWeek, todayIn, zonedToUtc } from './dates.js';

const MS_DAY = 86_400_000;
const hm = (time) => String(time).slice(0, 5);

/** لحظات البداية والنهاية (UTC) لفترة بدأت في يوم تقويمي معيّن */
function periodBounds(dateIso, period, timeZone) {
  const opens = hm(period.opens_at);
  const closes = hm(period.closes_at);
  const start = zonedToUtc(dateIso, opens, timeZone);
  let end;
  if (closes === opens) end = new Date(start.getTime() + MS_DAY);
  else if (closes > opens) end = zonedToUtc(dateIso, closes, timeZone);
  else end = zonedToUtc(addDays(dateIso, 1), closes, timeZone);
  return { start, end };
}

/** كل فترات الأيام من (اليوم + from) لحد (اليوم + to) كلحظات UTC، مرتّبة */
function periodsAround(hours, timeZone, now, from, to) {
  const today = todayIn(timeZone, now);
  const out = [];
  for (let offset = from; offset <= to; offset += 1) {
    const date = addDays(today, offset);
    const weekday = dayOfWeek(date);
    for (const period of hours) {
      if (Number(period.weekday) !== weekday) continue;
      out.push({ businessDate: date, ...periodBounds(date, period, timeZone) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * حالة المحل في لحظة معيّنة.
 * @returns {{ open: boolean, businessDate: string|null, closesAt: Date|null, nextOpensAt: Date|null }}
 *   businessDate: يوم الشغل لو فاتح (يوم بداية الفترة)، وإلا null.
 */
export function shopStatusAt(hours, timeZone, now = new Date()) {
  // امبارح عشان الفترات اللي عدّت نص الليل، وأسبوع قدّام عشان الميعاد الجاي
  const periods = periodsAround(hours, timeZone, now, -1, 7);
  const current = periods.find((period) => period.start <= now && now < period.end);
  const next = periods.find((period) => period.start > now) ?? null;
  return {
    open: Boolean(current),
    businessDate: current?.businessDate ?? null,
    closesAt: current?.end ?? null,
    nextOpensAt: next?.start ?? null,
  };
}

/**
 * يوم الشغل الحالي حتى لو المحل قافل: لو جوّه فترة، يومها؛ وإلا تاريخ
 * النهارده في منطقة المحل. (الاستقبال ممكن يضيف زبون قبل الفتح بدقايق.)
 */
export function businessDateAt(hours, timeZone, now = new Date()) {
  return shopStatusAt(hours, timeZone, now).businessDate ?? todayIn(timeZone, now);
}

/** تحقّق من فترات يوم واحد: مفيش فترتين بيتداخلوا (بعد تحويل اللي بيعدّي نص الليل) */
export function overlappingPeriods(periods) {
  const toRange = (period) => {
    const start = minutesOf(period.opens_at);
    let end = minutesOf(period.closes_at);
    if (end <= start) end += 24 * 60;
    return [start, end];
  };
  const ranges = periods.map(toRange).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i][0] < ranges[i - 1][1]) return true;
  }
  return false;
}

export function minutesOf(time) {
  const [hours, minutes] = hm(time).split(':').map(Number);
  return hours * 60 + minutes;
}
