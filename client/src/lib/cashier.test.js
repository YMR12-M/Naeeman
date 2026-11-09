import { describe, expect, test } from 'vitest';
import {
  allocate, cashierDiscountLimit, paymentState, rewardPreview, splitLine, tenderSuggestions,
} from './cashier.js';

describe('توزيع المبلغ', () => {
  test('المجموع مظبوط بالقرش', () => {
    const shares = allocate(1000, [3333, 3333, 3334]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(1000);
  });

  test('القرش الفاضل بيروح لأكبر كسر', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  test('مبلغ صفر أو أوزان صفر بيرجّع أصفار', () => {
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(500, [0, 0])).toEqual([0, 0]);
  });
});

describe('مكافأة الأختام', () => {
  const items = [
    { kind: 'service', service_id: 1, unit_price: 8000 },
    { kind: 'service', service_id: 2, unit_price: 12000 },
    { kind: 'product', service_id: null, unit_price: 5000 },
  ];
  const base = { loyalty_enabled: true };

  test('مقفولة = صفر', () => {
    expect(rewardPreview({ loyalty_enabled: false, loyalty_reward_type: 'amount', loyalty_reward_value: 5000 }, items, 20000)).toBe(0);
    expect(rewardPreview(null, items, 20000)).toBe(0);
  });

  test('خدمة معيّنة ببلاش', () => {
    const settings = { ...base, loyalty_reward_type: 'service', loyalty_reward_service_id: 1 };
    expect(rewardPreview(settings, items, 20000)).toBe(8000);
  });

  test('الخدمة المعيّنة مش في الفاتورة = صفر', () => {
    const settings = { ...base, loyalty_reward_type: 'service', loyalty_reward_service_id: 99 };
    expect(rewardPreview(settings, items, 20000)).toBe(0);
  });

  test('أغلى خدمة في الفاتورة', () => {
    expect(rewardPreview({ ...base, loyalty_reward_type: 'top_service' }, items, 20000)).toBe(12000);
  });

  test('المكافأة ما بتعدّيش اللي بعد الخصم', () => {
    expect(rewardPreview({ ...base, loyalty_reward_type: 'top_service' }, items, 5000)).toBe(5000);
    expect(rewardPreview({ ...base, loyalty_reward_type: 'amount', loyalty_reward_value: 9000 }, items, 4000)).toBe(4000);
  });

  test('مبلغ ونسبة', () => {
    expect(rewardPreview({ ...base, loyalty_reward_type: 'amount', loyalty_reward_value: 3000 }, items, 20000)).toBe(3000);
    expect(rewardPreview({ ...base, loyalty_reward_type: 'percent', loyalty_reward_value: 25 }, items, 20000)).toBe(5000);
  });

  test('نوع مجهول = صفر', () => {
    expect(rewardPreview({ ...base, loyalty_reward_type: 'x' }, items, 20000)).toBe(0);
  });
});

describe('خصم الاستقبال', () => {
  test('نسبة من المجموع بتتقرّب لأقرب قرش', () => {
    expect(cashierDiscountLimit(10000, 10)).toBe(1000);
    expect(cashierDiscountLimit(3333, 10)).toBe(333);
  });
});

describe('حالة الدفع', () => {
  test('دفع كاش بالظبط', () => {
    const state = paymentState({ total: 10000, lines: [{ kind: 'cash', amount: 10000, tendered: 10000 }] });
    expect(state).toMatchObject({ due: 10000, paid: 10000, remaining: 0, change: 0, valid: true, short: false });
  });

  test('الباقي للزبون من «اتدفع كام»', () => {
    const state = paymentState({ total: 10000, lines: [{ kind: 'cash', amount: 10000, tendered: 20000 }] });
    expect(state.change).toBe(10000);
    expect(state.valid).toBe(true);
  });

  test('البقشيش بيتضاف للمطلوب', () => {
    const lines = [{ kind: 'cash', amount: 10000, tendered: null }];
    expect(paymentState({ total: 10000, tip: 1000, lines })).toMatchObject({ due: 11000, remaining: 1000, valid: false });
    const full = [{ kind: 'cash', amount: 11000, tendered: null }];
    expect(paymentState({ total: 10000, tip: 1000, lines: full }).valid).toBe(true);
  });

  test('دفع مقسوم كاش وإنستاباي', () => {
    const state = paymentState({
      total: 10000,
      lines: [
        { kind: 'cash', amount: 4000, tendered: 5000 },
        { kind: 'transfer', amount: 6000 },
      ],
    });
    expect(state).toMatchObject({ paid: 10000, remaining: 0, change: 1000, valid: true });
  });

  test('اللي اتدفع أقل من المطلوب مش مقبول', () => {
    const state = paymentState({ total: 10000, lines: [{ kind: 'card', amount: 7000 }] });
    expect(state).toMatchObject({ remaining: 3000, valid: false });
  });

  test('الكاش المستلَم أقل من المبلغ مش مقبول', () => {
    const state = paymentState({ total: 10000, lines: [{ kind: 'cash', amount: 10000, tendered: 5000 }] });
    expect(state.short).toBe(true);
    expect(state.valid).toBe(false);
  });

  test('الفاتورة اللي كلها مكافأة (إجمالي صفر) بتتقفل من غير دفع', () => {
    expect(paymentState({ total: 0, lines: [] }).valid).toBe(true);
  });

  test('سطر دفع بصفر مرفوض لو فيه مطلوب', () => {
    const state = paymentState({ total: 5000, lines: [{ kind: 'cash', amount: 5000 }, { kind: 'card', amount: 0 }] });
    expect(state.valid).toBe(false);
  });
});

describe('تقسيم الدفع', () => {
  test('السطر الجديد بياخد الفاضل', () => {
    const lines = [{ method: 'cash', kind: 'cash', amount: 4000, tendered: null, reference: '' }];
    const next = splitLine(lines, 10000, { code: 'instapay', kind: 'transfer' });
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ method: 'instapay', kind: 'transfer', amount: 6000 });
  });

  test('لو اتدفع أكتر من المطلوب السطر الجديد صفر', () => {
    const lines = [{ method: 'cash', kind: 'cash', amount: 12000, tendered: null, reference: '' }];
    expect(splitLine(lines, 10000, { code: 'visa', kind: 'card' })[1].amount).toBe(0);
  });
});

describe('اقتراحات «اتدفع كام»', () => {
  test('المبلغ نفسه وأقرب أوراق أكبر منه', () => {
    expect(tenderSuggestions(8000)).toEqual([8000, 10000, 20000, 50000]);
  });

  test('مبلغ مقرّب ما بيكرّرش نفسه', () => {
    const out = tenderSuggestions(10000);
    expect(out[0]).toBe(10000);
    expect(new Set(out).size).toBe(out.length);
    expect(out.length).toBeLessThanOrEqual(4);
  });

  test('صفر أو سالب = من غير اقتراحات', () => {
    expect(tenderSuggestions(0)).toEqual([]);
    expect(tenderSuggestions(-5)).toEqual([]);
    expect(tenderSuggestions(null)).toEqual([]);
  });
});
