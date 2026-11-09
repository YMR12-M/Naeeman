import { describe, expect, test } from 'vitest';
import { customerOrigin, deviceOrigin, lanOrigin } from './hub.js';
import { formatBytes } from '../components/shop/Backups.jsx';

const hub = (patch = {}) => ({
  enabled: true,
  addresses: [{ name: 'Wi-Fi', address: '192.168.1.10' }, { name: 'Ethernet', address: '10.0.0.7' }],
  api_port: 4030,
  customer_port: 4031,
  ...patch,
});

describe('عناوين واي فاي المحل', () => {
  test('الأجهزة وتطبيق الزبون على عنوان الكمبيوتر وبورت كل واحد', () => {
    expect(deviceOrigin(hub())).toBe('http://192.168.1.10:4030');
    expect(customerOrigin(hub())).toBe('http://192.168.1.10:4031');
    expect(lanOrigin(hub(), 4999)).toBe('http://192.168.1.10:4999');
  });

  test('برّه وضع المحل: عنوان اللوحة نفسه، وتطبيق الزبون من غير عنوان', () => {
    expect(deviceOrigin(hub({ enabled: false }))).toBe(window.location.origin);
    expect(deviceOrigin(undefined)).toBe(window.location.origin);
    expect(customerOrigin(hub({ enabled: false }))).toBeNull();
  });

  test('الكمبيوتر من غير شبكة: مفيش عنوان بدل عنوان غلط', () => {
    expect(lanOrigin(hub({ addresses: [] }), 4030)).toBeNull();
    expect(customerOrigin(hub({ customer_port: null }))).toBeNull();
  });
});

describe('حجم النسخة', () => {
  test('بايت وكيلو وميجا', () => {
    expect(formatBytes(800)).toBe('800 بايت');
    expect(formatBytes(2048)).toBe('2 ك.ب');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 م.ب');
  });
});
