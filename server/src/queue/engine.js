/**
 * ═══════════════════════════════════════════════════════════════
 *  محرّك الطابور — دوال صافية من غير قاعدة بيانات
 *
 *  كل اللي هنا بياخد صورة الطابور ويرجّع قرار، فبيتختبر لوحده:
 *    • estimateQueue  الوقت المتوقّع لكل دور، وقدّامه كام، وهيروح لمين
 *    • pickNext       زرار «التالي»: مين يقعد على الكرسي، ومين يتنادى
 *    • delayKey / keyBetween   ترتيب الطابور بأرقام عشرية
 *    • learnStat      تعلّم مدّة الخدمة عند كل حلاق
 * ═══════════════════════════════════════════════════════════════
 */

const MINUTE = 60_000;

/** أقل وقت فاضل للزبون اللي على الكرسي، حتى لو عدّى المدّة المتوقّعة */
export const MIN_REMAINING_MINUTES = 2;
/** معامل المتوسّط المتحرّك، وكام عيّنة قبل ما نثق في مدّة الحلاق */
export const EWMA_ALPHA = 0.2;
export const MIN_SAMPLES = 5;
/** المسافة بين أرقام الترتيب للأدوار الجديدة */
export const KEY_STEP = 1000;

const statKey = (barberId, serviceId) => `${barberId}:${serviceId}`;

/** المدّة اللي نثق فيها لخدمة عند حلاق: المتعلّمة لو عيّناتها كفاية، وإلا الافتراضية */
export function learnedMinutes(stat, defaultMinutes) {
  return stat && stat.samples >= MIN_SAMPLES ? Number(stat.avg_minutes) : defaultMinutes;
}

/** مدّة دور كامل (مجموع خدماته) عند حلاق معيّن */
export function ticketMinutes(ticket, barberId, stats = new Map()) {
  return ticket.services.reduce(
    (sum, service) => sum + learnedMinutes(stats.get(statKey(barberId, service.service_id)), service.minutes),
    0,
  );
}

/**
 * الوقت المتوقّع لكل دور.
 *
 * محاكاة بسيطة: لكل حلاق «فاضي امتى»، وبعدين نلف على الطابور بالترتيب.
 * الدور اللي طالب حلاق معيّن بياخد وقت الحلاق ده، و«أي حد» بياخد أقرب
 * حلاق هيفضى (ولو اتعادلوا: الأقدم في ترتيب الحلاقين).
 *
 * @param {object}   input
 * @param {Date}     input.now
 * @param {object[]} input.barbers  [{ id, status, break_until }] بترتيب العرض (من غير المؤرشفين)
 * @param {object[]} input.tickets  الأدوار الشغّالة (waiting + serving)، والـ waiting بترتيب الطابور
 * @param {Map}      [input.stats]  'barberId:serviceId' ← { avg_minutes, samples }
 * @returns {{ tickets: Map<number, {start: Date|null, barberId: number|null, ahead: number|null, unavailable?: boolean}>,
 *             freeAt: Map<number, Date> }}
 */
export function estimateQueue({ now, barbers, tickets, stats = new Map() }) {
  const nowMs = now.getTime();
  const freeAt = new Map();
  const order = [];

  for (const barber of barbers) {
    if (barber.status === 'off') continue;
    let at = nowMs;
    if (barber.status === 'break' && barber.break_until && barber.break_until.getTime() > nowMs) {
      at = barber.break_until.getTime();
    }
    freeAt.set(barber.id, at);
    order.push(barber.id);
  }

  // اللي على الكرسي دلوقتي: الحلاق يفضى بعد ما يخلّص (ولو عدّى المدّة، كمان دقيقتين)
  for (const ticket of tickets) {
    if (ticket.status !== 'serving' || !ticket.barber_id) continue;
    const started = ticket.started_at ? ticket.started_at.getTime() : nowMs;
    const end = Math.max(
      started + ticketMinutes(ticket, ticket.barber_id, stats) * MINUTE,
      nowMs + MIN_REMAINING_MINUTES * MINUTE,
    );
    if (!freeAt.has(ticket.barber_id)) {
      // حلاق مش «موجود» بس لسه معاه زبون: يفضل خارج الحساب للأدوار الجاية
      continue;
    }
    freeAt.set(ticket.barber_id, Math.max(freeAt.get(ticket.barber_id), end));
  }

  const result = new Map();
  const scheduledStarts = [];

  for (const ticket of tickets) {
    if (ticket.status !== 'waiting') continue;

    let barberId = ticket.preferred_barber_id ?? null;
    if (barberId !== null && !freeAt.has(barberId)) {
      // الحلاق اللي طلبه مش موجود النهارده: مفيش وقت نقدر نوعد بيه
      result.set(ticket.id, { start: null, barberId, ahead: null, unavailable: true });
      continue;
    }
    if (barberId === null) {
      if (order.length === 0) {
        result.set(ticket.id, { start: null, barberId: null, ahead: null, unavailable: true });
        continue;
      }
      barberId = order.reduce((best, id) => (freeAt.get(id) < freeAt.get(best) ? id : best), order[0]);
    }

    const start = freeAt.get(barberId);
    // «قدّامك كام» = الأدوار اللي قبلك في الطابور وهتبدأ قبلك فعلًا
    const ahead = scheduledStarts.filter((value) => value < start).length;
    result.set(ticket.id, { start: new Date(start), barberId, ahead });
    scheduledStarts.push(start);
    freeAt.set(barberId, start + ticketMinutes(ticket, barberId, stats) * MINUTE);
  }

  return {
    tickets: result,
    freeAt: new Map([...freeAt].map(([id, at]) => [id, new Date(at)])),
  };
}

/**
 * زرار «التالي» للحلاق B.
 * المرشّحين: أدوار waiting بترتيب الطابور، اللي طالبين B أو «أي حد».
 * أوّل مرشّح واصل يقعد على الكرسي. أي مرشّح قبله ومش واصل بيتنادى ومكانه محفوظ.
 *
 * @returns {{ start: object|null, toCall: object[] }}
 */
export function pickNext(barberId, waiting) {
  const toCall = [];
  for (const ticket of waiting) {
    if (ticket.status !== 'waiting') continue;
    if (ticket.preferred_barber_id !== null && ticket.preferred_barber_id !== undefined && ticket.preferred_barber_id !== barberId) continue;
    if (ticket.arrived_at) return { start: ticket, toCall };
    toCall.push(ticket);
  }
  return { start: null, toCall };
}

/** رقم ترتيب بين اتنين (أي واحد منهم ممكن يكون null = أول/آخر الطابور) */
export function keyBetween(before, after) {
  if (before === null && after === null) return KEY_STEP;
  if (before === null) return after - KEY_STEP;
  if (after === null) return before + KEY_STEP;
  return (before + after) / 2;
}

/** لو الأرقام قرّبت من بعض لدرجة إن الأعشار ما تكفّيش، نرقّم الطابور من جديد */
export const keysTooClose = (before, after) =>
  before !== null && after !== null && Math.abs(after - before) < 1e-6;

/**
 * «أخّرني» = يرجع ورا خطوات. waiting بترتيب الطابور.
 * @returns {number|null} مكانه الجديد في الطابور من غيره (0 = أول واحد)، أو null لو مفيش حد وراه
 */
export function delayTarget(waiting, ticketId, steps = 2) {
  const index = waiting.findIndex((ticket) => ticket.id === ticketId);
  if (index === -1) return null;
  const behind = waiting.length - index - 1;
  if (behind === 0) return null;
  return index + Math.min(steps, behind);
}

/**
 * رقم الترتيب لدور هيتحط في مكان معيّن من الطابور (من غيره).
 * @returns {number|null} null = الأرقام قرّبت من بعض، ولازم نرقّم الطابور من جديد
 */
export function keyAt(others, index) {
  const before = others[index - 1]?.sort_key ?? null;
  const after = others[index]?.sort_key ?? null;
  if (keysTooClose(before, after)) return null;
  return keyBetween(before, after);
}

/**
 * تعلّم مدّة خدمة من دور خلص.
 * @returns {{ avg_minutes: number, samples: number }|null}  null = رقم شاذ ما يتحسبش
 */
export function learnStat(stat, defaultMinutes, actualMinutes) {
  const expected = learnedMinutes(stat, defaultMinutes);
  if (!(actualMinutes >= expected * 0.3 && actualMinutes <= expected * 3)) return null;
  const base = stat ? Number(stat.avg_minutes) : defaultMinutes;
  return {
    avg_minutes: Math.round((base + EWMA_ALPHA * (actualMinutes - base)) * 100) / 100,
    samples: (stat?.samples ?? 0) + 1,
  };
}

/** الانتظار بالدقايق مقرّب لأقرب 5 (اللي بيتعرض للزبون: «حوالي 25 دقيقة») */
export function roundedWait(start, now) {
  if (!start) return null;
  const minutes = Math.max(0, (start.getTime() - now.getTime()) / MINUTE);
  return Math.round(minutes / 5) * 5;
}
