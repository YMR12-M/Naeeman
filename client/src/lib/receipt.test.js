import { describe, expect, test } from 'vitest';
import { dayCloseHtml, money, receiptHtml } from './receipt.js';

const shop = { name: 'صالون زمان', address: 'شارع التحرير', city: 'الجيزة', phone: '01012345678', url: 'https://zaman.example.com' };

const bill = (patch = {}) => ({
  number: 41,
  status: 'paid',
  created_at: '2026-11-09T10:00:00Z',
  paid_at: '2026-11-09T10:40:00Z',
  customer_name: 'أحمد',
  ticket: { number: 7 },
  subtotal: 13000,
  discount: 0,
  reward_discount: 0,
  total: 13000,
  tip: 0,
  change_given: 0,
  items: [
    { kind: 'service', name: 'قص شعر', qty: 1, line_total: 8000, barber_name: 'مصطفى' },
    { kind: 'product', name: 'جِل', qty: 2, line_total: 5000, barber_name: null },
  ],
  payments: [{ kind: 'payment', method_label: 'كاش', amount: 13000 }],
  card: null,
  ...patch,
});

describe('الأرقام على الإيصال', () => {
  test('القروش جنيهات بفاصل آلاف', () => {
    expect(money(8000)).toBe('80');
    expect(money(12050)).toBe('120.50');
    expect(money(123456700)).toBe('1,234,567');
    expect(money(null)).toBe('0');
  });
});

describe('إيصال الفاتورة', () => {
  test('بيعرض المحل والسطور والإجمالي والدفع', () => {
    const html = receiptHtml({ shop, bill: bill(), width: 80 });
    expect(html).toContain('صالون زمان');
    expect(html).toContain('شارع التحرير، الجيزة');
    expect(html).toContain('#41');
    expect(html).toContain('قص شعر');
    expect(html).toContain('أ. مصطفى');
    expect(html).toContain('× 2');
    expect(html).toContain('الإجمالي (ج)');
    expect(html).toContain('كاش');
    expect(html).toContain('zaman.example.com');
    expect(html).not.toContain('https://zaman.example.com');
  });

  test('المقاس بيتحدّد من الإعداد', () => {
    expect(receiptHtml({ shop, bill: bill(), width: 58 })).toContain('size: 58mm auto');
    expect(receiptHtml({ shop, bill: bill(), width: 80 })).toContain('size: 80mm auto');
  });

  test('الخصم والمكافأة والبقشيش والباقي', () => {
    const html = receiptHtml({
      shop,
      bill: bill({ discount: 1000, discount_reason: 'زبون قديم', reward_discount: 8000, total: 4000, tip: 500, change_given: 1500,
        payments: [{ kind: 'payment', method_label: 'كاش', amount: 4500 }] }),
      width: 80,
    });
    expect(html).toContain('خصم (زبون قديم)');
    expect(html).toContain('مكافأة الأختام');
    expect(html).toContain('بقشيش');
    expect(html).toContain('الباقي');
  });

  test('المرتجع بيظهر بالسالب', () => {
    const html = receiptHtml({
      shop,
      bill: bill({ payments: [
        { kind: 'payment', method_label: 'كاش', amount: 13000 },
        { kind: 'refund', method_label: 'كاش', amount: -3000 },
      ] }),
      width: 80,
    });
    expect(html).toContain('مرتجع (كاش)');
    expect(html).toContain('-30');
  });

  test('فاتورة مفتوحة بتتعلّم إنها لسه ما اتدفعتش', () => {
    const html = receiptHtml({ shop, bill: bill({ status: 'open', paid_at: null, payments: [] }), width: 80 });
    expect(html).toContain('لسه ما اتدفعتش');
  });

  test('كارت الأختام: فاضلّك كام، وبعدين المكافأة', () => {
    const left = receiptHtml({
      shop,
      bill: bill({ card: { loyalty: { enabled: true, stamps: 6, required: 9, left: 3, eligible: false, reward: 'قص ببلاش' } } }),
      width: 80,
    });
    expect(left).toContain('●●●●●●○○○');
    expect(left).toContain('فاضلّك');
    expect(left).toContain('قص ببلاش');

    const ready = receiptHtml({
      shop,
      bill: bill({ card: { loyalty: { enabled: true, stamps: 9, required: 9, left: 0, eligible: true, reward: 'قص ببلاش' } } }),
      width: 80,
    });
    expect(ready).toContain('الزيارة الجاية: قص ببلاش');
  });

  test('الأختام المقفولة ما بتظهرش', () => {
    const html = receiptHtml({ shop, bill: bill({ card: { loyalty: { enabled: false } } }), width: 80 });
    expect(html).not.toContain('class="stamps"');
  });

  test('الأسماء بتتهرّب من HTML', () => {
    const html = receiptHtml({
      shop: { ...shop, name: '<script>alert(1)</script>' },
      bill: bill({ customer_name: '"><img src=x>' }),
      width: 80,
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  test('نسخة تانية بتتعلّم', () => {
    expect(receiptHtml({ shop, bill: bill(), width: 80 }, { copy: true })).toContain('نسخة');
    expect(receiptHtml({ shop, bill: bill(), width: 80 })).not.toContain('>نسخة<');
  });

  test('سطر آخر من الإعدادات', () => {
    expect(receiptHtml({ shop, bill: bill(), width: 80, footer: 'شكرًا لزيارتكم' })).toContain('شكرًا لزيارتكم');
  });
});

describe('تقرير التقفيل', () => {
  const close = {
    number: 12,
    period_start: '2026-11-08T07:00:00Z',
    period_end: '2026-11-09T19:00:00Z',
    closed_by_name: 'منى',
    summary: {
      bills: 18,
      services_sales: 150000,
      products_sales: 20000,
      discounts: 5000,
      rewards: 8000,
      sales: 157000,
      tips: 3000,
      refunds: 2000,
      collected: 158000,
      variance: -500,
      methods: [{ label: 'كاش', net: 120000 }, { label: 'إنستاباي', net: 38000 }],
      movements: { expense: 4000, advance: 10000, payout: 0, cash_in: 0, cash_out: 20000 },
      barbers: [{ name: 'مصطفى', customers: 11, services: 90000, products: 10000 }],
      open_bills: { count: 2 },
    },
  };

  test('بيعرض الأرقام والطرق والحلاقين', () => {
    const html = dayCloseHtml(close, { shopName: 'صالون زمان', width: 80 });
    expect(html).toContain('تقفيل رقم');
    expect(html).toContain('1,570');
    expect(html).toContain('إنستاباي');
    expect(html).toContain('أ. مصطفى');
    expect(html).toContain('منى');
  });

  test('العجز والزيادة بالعلامة الصح', () => {
    expect(dayCloseHtml(close, { shopName: 'م' })).toContain('عجز');
    const over = { ...close, summary: { ...close.summary, variance: 700 } };
    expect(dayCloseHtml(over, { shopName: 'م' })).toContain('زيادة');
  });

  test('الفواتير المفتوحة المترحّلة بتتنبّه', () => {
    expect(dayCloseHtml(close, { shopName: 'م' })).toContain('فاتورة مفتوحة اترحّلت');
    const none = { ...close, summary: { ...close.summary, open_bills: { count: 0 } } };
    expect(dayCloseHtml(none, { shopName: 'م' })).not.toContain('اترحّلت');
  });
});
