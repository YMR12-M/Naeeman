import { describe, expect, test } from 'vitest';
import {
  etaLabel, formatMinutes, formatMoney, formatPhone, inputToMinor, minorToInput, minutesSince, whatsappLink,
} from './format.js';

// علامات العزل الاتجاهي بتتشال عشان المقارنة تبقى على النص نفسه
const plain = (text) => text.replace(/[⁦-⁩]/g, '');

describe('الفلوس', () => {
  test('القروش بتتعرض جنيهات والعملة بعد الرقم', () => {
    expect(plain(formatMoney(8000))).toBe('80 ج');
    expect(plain(formatMoney(12050))).toBe('120.50 ج');
    expect(plain(formatMoney(0))).toBe('0 ج');
    expect(formatMoney(null)).toBe('—');
  });

  test('علامة الناقص والزائد جوّه العزل مش برّاه', () => {
    expect(plain(formatMoney(16000, { sign: '−' }))).toBe('−160 ج');
    expect(plain(formatMoney(150, { sign: '+' }))).toBe('+1.50 ج');
    // العلامة جوّه الحدود، فمفيش حاجة بتلزق في «ج»
    expect(formatMoney(16000, { sign: '−' }).startsWith('\u2067−')).toBe(true);
    expect(formatMoney(null, { sign: '−' })).toBe('—');
  });

  test('اللي المستخدم كتبه بيتحوّل لقروش صحيحة', () => {
    expect(inputToMinor('80')).toBe(8000);
    expect(inputToMinor('12.5')).toBe(1250);
    expect(inputToMinor('١٢٠')).toBe(12000);
    expect(inputToMinor('7,25')).toBe(725);
    expect(inputToMinor('')).toBeNull();
    expect(inputToMinor('abc')).toBeNull();
    expect(inputToMinor('-5')).toBeNull();
    expect(minorToInput(8050)).toBe('80.5');
  });
});

describe('الدقايق', () => {
  test('العدد بيتقال زي الكلام', () => {
    expect(formatMinutes(1)).toBe('دقيقة');
    expect(formatMinutes(2)).toBe('دقيقتين');
    expect(formatMinutes(3)).toBe('3 دقايق');
    expect(formatMinutes(10)).toBe('10 دقايق');
    expect(formatMinutes(25)).toBe('25 دقيقة');
    expect(formatMinutes(null)).toBe('—');
  });

  test('الساعات', () => {
    expect(formatMinutes(60)).toBe('ساعة');
    expect(formatMinutes(130)).toBe('ساعتين و10 د');
    expect(formatMinutes(185)).toBe('3 ساعات و5 د');
  });

  test('الوقت المتوقّع بالنسبة لدلوقتي', () => {
    const now = Date.parse('2026-10-24T20:00:00Z');
    expect(etaLabel('2026-10-24T20:25:00Z', now)).toBe('بعد 25 د');
    expect(etaLabel('2026-10-24T20:00:30Z', now)).toBe('دلوقتي');
    expect(etaLabel(null, now)).toBe('—');
    expect(minutesSince('2026-10-24T19:47:00Z', now)).toBe(13);
  });
});

describe('الموبايل وواتساب', () => {
  test('الرقم المصري بيتعرض مقسّم', () => {
    expect(formatPhone('+201012345678')).toBe('0101 234 5678');
    expect(formatPhone('+4479460000')).toBe('+4479460000');
  });

  test('رابط واتساب من غير علامات العزل', () => {
    const link = whatsappLink('+201012345678', `دورك رقم ⁦5⁩`);
    expect(link.startsWith('https://wa.me/201012345678?text=')).toBe(true);
    expect(decodeURIComponent(link.split('text=')[1])).toBe('دورك رقم 5');
  });
});
