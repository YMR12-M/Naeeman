/**
 * إعدادات البرنامج على الجهاز (userData/config.json): الوضع (سيرفر المحل أو
 * اتصال بسيرفر)، وعنوان السيرفر، وإعدادات وضع المحل، وطابعة الإيصالات.
 * وتوكن تجديد جلسة الموظف في ملف لوحده مشفّر بـ safeStorage (Keychain على
 * الماك، وDPAPI على ويندوز). لو التشفير مش متاح، التوكن بيفضل في الذاكرة
 * والموظف يدخل تاني كل ما البرنامج يفتح — أحسن من ملف مكشوف.
 */
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const file = (name) => path.join(app.getPath('userData'), name);

export function readConfig() {
  try { return JSON.parse(readFileSync(file('config.json'), 'utf8')); } catch { return {}; }
}

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  // فيه سرّ الجلسات وكلمة سر القاعدة في وضع المحل: للمستخدم بس
  writeFileSync(file('config.json'), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

/** «192.168.1.10:4030» ← «http://192.168.1.10:4030» من غير / في الآخر، أو null لو مش عنوان */
export function normalizeServerUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

let memoryToken = null;

export const session = {
  get() {
    if (!safeStorage.isEncryptionAvailable()) return memoryToken;
    try { return existsSync(file('session.bin')) ? safeStorage.decryptString(readFileSync(file('session.bin'))) : null; } catch { return null; }
  },
  set(token) {
    if (!safeStorage.isEncryptionAvailable()) { memoryToken = token; return; }
    writeFileSync(file('session.bin'), safeStorage.encryptString(token));
  },
  clear() {
    memoryToken = null;
    rmSync(file('session.bin'), { force: true });
  },
};
