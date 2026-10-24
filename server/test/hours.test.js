import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { businessDateAt, overlappingPeriods, shopStatusAt } from '../src/utils/hours.js';

const TZ = 'Africa/Cairo';

/** لحظة «على جدار» القاهرة. أكتوبر 2026: القاهرة UTC+3 (توقيت صيفي) */
const cairo = (iso) => new Date(`${iso}+03:00`);

// 2026-10-23 جمعة (5)، 2026-10-24 سبت (6)
const daily = (opens, closes) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: opens, closes_at: closes }));

describe('فاتح دلوقتي؟', () => {
  test('فترة عادية في نفس اليوم', () => {
    const hours = daily('10:00', '22:00');
    assert.equal(shopStatusAt(hours, TZ, cairo('2026-10-23T09:59:00')).open, false);
    const inside = shopStatusAt(hours, TZ, cairo('2026-10-23T15:00:00'));
    assert.equal(inside.open, true);
    assert.equal(inside.businessDate, '2026-10-23');
    assert.equal(inside.closesAt.toISOString(), '2026-10-23T19:00:00.000Z');
    assert.equal(shopStatusAt(hours, TZ, cairo('2026-10-23T22:00:00')).open, false);
  });

  test('محل بيقفل 2 بالليل: الساعة 1 بالليل لسه يوم شغل امبارح', () => {
    const hours = daily('14:00', '02:00');
    const lateNight = shopStatusAt(hours, TZ, cairo('2026-10-24T01:00:00'));
    assert.equal(lateNight.open, true);
    assert.equal(lateNight.businessDate, '2026-10-23');
    assert.equal(lateNight.closesAt.toISOString(), '2026-10-23T23:00:00.000Z');
    assert.equal(shopStatusAt(hours, TZ, cairo('2026-10-24T03:00:00')).open, false);
  });

  test('فترات ورا بعض من غير فاصل: المحل ما بيقفلش في النص', () => {
    // فاتح 24 ساعة كل يوم ما عدا الجمعة: يقفل أوّل الجمعة بس
    const allDay = daily('00:00', '00:00').filter((period) => period.weekday !== 5);
    const wednesdayNight = shopStatusAt(allDay, TZ, cairo('2026-10-21T23:30:00'));
    assert.equal(wednesdayNight.open, true);
    assert.equal(wednesdayNight.businessDate, '2026-10-21', 'يوم الشغل نفسه زي ما هو');
    assert.equal(wednesdayNight.closesAt.toISOString(), '2026-10-22T21:00:00.000Z');

    // بيقفل 12 بالليل ويفتح من 12 بالليل لحد 3 الفجر
    const chained = [
      ...daily('12:00', '00:00').map((period) => ({ ...period })),
      ...daily('00:00', '03:00'),
    ];
    const lateEvening = shopStatusAt(chained, TZ, cairo('2026-10-23T23:00:00'));
    assert.equal(lateEvening.closesAt.toISOString(), '2026-10-24T00:00:00.000Z');
  });

  test('قافل: إمتى بيفتح؟ حتى لو بعد إجازة', () => {
    // الجمعة إجازة، الشغل من السبت
    const hours = daily('10:00', '22:00').filter((period) => period.weekday !== 5);
    const friday = shopStatusAt(hours, TZ, cairo('2026-10-23T12:00:00'));
    assert.equal(friday.open, false);
    assert.equal(friday.businessDate, null);
    assert.equal(friday.nextOpensAt.toISOString(), '2026-10-24T07:00:00.000Z');
  });

  test('فاتح 24 ساعة لما الفتح = القفل', () => {
    const hours = daily('00:00', '00:00');
    assert.equal(shopStatusAt(hours, TZ, cairo('2026-10-23T03:30:00')).open, true);
  });

  test('فترتين في اليوم (قافل وقت الصلاة مثلًا)', () => {
    const hours = [{ weekday: 5, opens_at: '10:00', closes_at: '12:30' }, { weekday: 5, opens_at: '14:00', closes_at: '23:00' }];
    assert.equal(shopStatusAt(hours, TZ, cairo('2026-10-23T13:00:00')).open, false);
    assert.equal(shopStatusAt(hours, TZ, cairo('2026-10-23T13:00:00')).nextOpensAt.toISOString(), '2026-10-23T11:00:00.000Z');
    assert.equal(shopStatusAt(hours, TZ, cairo('2026-10-23T15:00:00')).open, true);
  });

  test('من غير مواعيد خالص: قافل ومفيش ميعاد جاي', () => {
    const status = shopStatusAt([], TZ, cairo('2026-10-23T15:00:00'));
    assert.equal(status.open, false);
    assert.equal(status.nextOpensAt, null);
  });

  test('يوم الشغل وهو قافل = تاريخ النهارده', () => {
    assert.equal(businessDateAt([], TZ, cairo('2026-10-23T08:00:00')), '2026-10-23');
  });
});

test('تداخل الفترات في نفس اليوم', () => {
  assert.equal(overlappingPeriods([{ opens_at: '10:00', closes_at: '14:00' }, { opens_at: '13:00', closes_at: '18:00' }]), true);
  assert.equal(overlappingPeriods([{ opens_at: '10:00', closes_at: '14:00' }, { opens_at: '14:00', closes_at: '18:00' }]), false);
  assert.equal(overlappingPeriods([{ opens_at: '20:00', closes_at: '02:00' }, { opens_at: '23:00', closes_at: '23:30' }]), true);
});
