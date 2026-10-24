import { describe, expect, test } from 'vitest';
import { readScan } from './shop.js';
import { safeNext } from './nav.js';

describe('قراية الـ QR', () => {
  test('QR «وصلت» اللي على التلفزيون: المحل والكود', () => {
    expect(readScan('https://app.naeeman.example/checkin/elamal?code=123456')).toEqual({ slug: 'elamal', code: '123456' });
  });

  test('QR «خُد دورك»: صفحة المحل', () => {
    expect(readScan('http://localhost:5201/s/elamal')).toEqual({ path: '/s/elamal' });
  });

  test('الكود مكتوب بإيده', () => {
    expect(readScan(' 654321 ')).toEqual({ code: '654321' });
  });

  test('أي حاجة تانية: مرفوضة', () => {
    expect(readScan('https://evil.example/checkin/x?code=12')).toBeNull();
    expect(readScan('hello')).toBeNull();
    expect(readScan('12345')).toBeNull();
    expect(readScan('https://shop.example/admin')).toBeNull();
  });
});

describe('الرجوع بعد الدخول', () => {
  test('مسار جوّه التطبيق بس', () => {
    expect(safeNext('/s/elamal/take')).toBe('/s/elamal/take');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
