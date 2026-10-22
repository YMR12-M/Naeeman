import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  delayTarget, estimateQueue, keyAt, keyBetween, learnStat, learnedMinutes, pickNext, roundedWait,
} from '../src/queue/engine.js';
import { canTransition } from '../src/queue/states.js';

const NOW = new Date('2026-10-23T12:00:00Z');
const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000);
const mins = (date) => Math.round((date - NOW) / 60_000);

const barber = (id, status = 'available', extra = {}) => ({ id, status, break_until: null, ...extra });
let nextId = 1;
const ticket = (overrides = {}) => ({
  id: nextId++,
  status: 'waiting',
  preferred_barber_id: null,
  barber_id: null,
  arrived_at: NOW,
  started_at: null,
  sort_key: nextId * 1000,
  services: [{ service_id: 1, minutes: 25 }],
  ...overrides,
});

describe('الوقت المتوقّع', () => {
  test('حلاق واحد، تلات أدوار: كل واحد بعد اللي قبله', () => {
    const tickets = [ticket(), ticket(), ticket()];
    const result = estimateQueue({ now: NOW, barbers: [barber(1)], tickets }).tickets;
    assert.deepEqual(tickets.map((t) => mins(result.get(t.id).start)), [0, 25, 50]);
    assert.deepEqual(tickets.map((t) => result.get(t.id).ahead), [0, 1, 2]);
  });

  test('اللي على الكرسي: الحلاق يفضى بعد الباقي من مدّته', () => {
    const serving = ticket({ status: 'serving', barber_id: 1, started_at: at(-10) });
    const waiting = ticket();
    const result = estimateQueue({ now: NOW, barbers: [barber(1)], tickets: [serving, waiting] });
    assert.equal(mins(result.tickets.get(waiting.id).start), 15);
  });

  test('اللي عدّى مدّته: لسه قدّامه دقيقتين على الأقل', () => {
    const serving = ticket({ status: 'serving', barber_id: 1, started_at: at(-60) });
    const waiting = ticket();
    const result = estimateQueue({ now: NOW, barbers: [barber(1)], tickets: [serving, waiting] });
    assert.equal(mins(result.tickets.get(waiting.id).start), 2);
  });

  test('حلاقين و«أي حد»: الاتنين يبدأوا مع بعض، و«قدّامك» يعدّ اللي هيبدأ قبلك بس', () => {
    const tickets = [ticket(), ticket(), ticket(), ticket()];
    const result = estimateQueue({ now: NOW, barbers: [barber(1), barber(2)], tickets }).tickets;
    assert.deepEqual(tickets.map((t) => mins(result.get(t.id).start)), [0, 0, 25, 25]);
    assert.deepEqual(tickets.map((t) => result.get(t.id).ahead), [0, 0, 2, 2]);
    assert.deepEqual(tickets.map((t) => result.get(t.id).barberId), [1, 2, 1, 2]);
  });

  test('اللي طالب حلاق معيّن بيستناه حتى لو غيره فاضي', () => {
    const tickets = [ticket({ preferred_barber_id: 1 }), ticket({ preferred_barber_id: 1 }), ticket()];
    const result = estimateQueue({ now: NOW, barbers: [barber(1), barber(2)], tickets }).tickets;
    assert.deepEqual(tickets.map((t) => mins(result.get(t.id).start)), [0, 25, 0]);
    assert.equal(result.get(tickets[2].id).barberId, 2);
    assert.equal(result.get(tickets[2].id).ahead, 0);
  });

  test('حلاق في استراحة: يبدأ بعد ما ترجع', () => {
    const waiting = ticket({ preferred_barber_id: 1 });
    const result = estimateQueue({ now: NOW, barbers: [barber(1, 'break', { break_until: at(20) })], tickets: [waiting] });
    assert.equal(mins(result.tickets.get(waiting.id).start), 20);
  });

  test('الحلاق المطلوب مش موجود: مفيش وقت، والباقي عادي', () => {
    const tickets = [ticket({ preferred_barber_id: 1 }), ticket()];
    const result = estimateQueue({ now: NOW, barbers: [barber(1, 'off'), barber(2)], tickets }).tickets;
    assert.equal(result.get(tickets[0].id).unavailable, true);
    assert.equal(result.get(tickets[0].id).start, null);
    assert.equal(mins(result.get(tickets[1].id).start), 0);
  });

  test('مفيش حلاقين خالص', () => {
    const waiting = ticket();
    const result = estimateQueue({ now: NOW, barbers: [barber(1, 'off')], tickets: [waiting] });
    assert.equal(result.tickets.get(waiting.id).unavailable, true);
  });

  test('المدّة المتعلّمة بتتستعمل بس بعد 5 عيّنات، وخدمتين = مجموعهم', () => {
    const tickets = [ticket({ services: [{ service_id: 1, minutes: 25 }, { service_id: 2, minutes: 15 }] }), ticket()];
    const learning = new Map([['1:1', { avg_minutes: 18, samples: 4 }]]);
    const trusted = new Map([['1:1', { avg_minutes: 18, samples: 5 }]]);
    assert.equal(mins(estimateQueue({ now: NOW, barbers: [barber(1)], tickets, stats: learning }).tickets.get(tickets[1].id).start), 40);
    assert.equal(mins(estimateQueue({ now: NOW, barbers: [barber(1)], tickets, stats: trusted }).tickets.get(tickets[1].id).start), 33);
  });
});

describe('زرار «التالي»', () => {
  test('أوّل واصل يقعد، واللي قبله ومش واصل يتنادى', () => {
    const remote = ticket({ arrived_at: null });
    const walkIn = ticket();
    const { start, toCall } = pickNext(1, [remote, walkIn]);
    assert.equal(start.id, walkIn.id);
    assert.deepEqual(toCall.map((t) => t.id), [remote.id]);
  });

  test('اللي طالب حلاق تاني ما يتلمسش', () => {
    const forOther = ticket({ preferred_barber_id: 2 });
    const forMe = ticket({ preferred_barber_id: 1 });
    const { start, toCall } = pickNext(1, [forOther, forMe]);
    assert.equal(start.id, forMe.id);
    assert.deepEqual(toCall, []);
  });

  test('مفيش حد', () => {
    assert.deepEqual(pickNext(1, []), { start: null, toCall: [] });
  });
});

describe('ترتيب الطابور', () => {
  const list = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, sort_key: (i + 1) * 1000 }));

  test('«أخّرني» = خطوتين لورا، أو آخر الطابور، أو مفيش', () => {
    assert.equal(delayTarget(list(5), 1, 2), 2);
    assert.equal(delayTarget(list(5), 4, 2), 4);
    assert.equal(delayTarget(list(5), 5, 2), null);
  });

  test('رقم الترتيب في النص، وأوّل وآخر الطابور', () => {
    const others = list(3);
    assert.equal(keyAt(others, 1), 1500);
    assert.equal(keyAt(others, 0), 0);
    assert.equal(keyAt(others, 3), 4000);
    assert.equal(keyBetween(null, null), 1000);
  });

  test('لو الأرقام قرّبت من بعض: لازم ترقيم جديد', () => {
    assert.equal(keyAt([{ sort_key: 1 }, { sort_key: 1 + 1e-9 }], 1), null);
  });
});

describe('تعلّم المدّة', () => {
  test('متوسّط متحرّك يبدأ من المدّة الافتراضية', () => {
    assert.deepEqual(learnStat(null, 25, 20), { avg_minutes: 24, samples: 1 });
    assert.deepEqual(learnStat({ avg_minutes: 24, samples: 1 }, 25, 20), { avg_minutes: 23.2, samples: 2 });
  });

  test('الأرقام الشاذّة ما بتتحسبش (نسي يدوس «التالي»، أو داس بالغلط)', () => {
    assert.equal(learnStat(null, 25, 2), null);
    assert.equal(learnStat(null, 25, 90), null);
  });

  test('قبل 5 عيّنات: المدّة الافتراضية', () => {
    assert.equal(learnedMinutes({ avg_minutes: 10, samples: 4 }, 25), 25);
    assert.equal(learnedMinutes({ avg_minutes: 10, samples: 5 }, 25), 10);
  });
});

test('الانتظار للزبون مقرّب لأقرب 5', () => {
  assert.equal(roundedWait(at(23), NOW), 25);
  assert.equal(roundedWait(at(2), NOW), 0);
  assert.equal(roundedWait(null, NOW), null);
});

test('الانتقالات المسموحة', () => {
  assert.equal(canTransition('waiting', 'serving', 'chair'), true);
  assert.equal(canTransition('waiting', 'serving', 'customer'), false);
  assert.equal(canTransition('serving', 'cancelled', 'customer'), false);
  assert.equal(canTransition('done', 'waiting', 'staff'), false);
  assert.equal(canTransition('waiting', 'no_show', 'system'), true);
});
