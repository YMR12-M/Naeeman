/**
 * اختبار تشغيل «المحل هو السيرفر» جوّه Electron من غير نافذة: بيجهّز قاعدة
 * مؤقّتة وبيانات مؤقّتة، وبيشغّل البرنامج، وبيتأكد إنه قام بالسيرفر، واللوحة
 * اتحمّلت من app://، والجسر (الطباعة وحالة السيرفر) موجود، والبرنامج وقّف
 * السيرفر وهو بيقفل. ما بيلمسش بيانات المحل الحقيقية.
 *
 *   cd desktop && npm run build:client && npm run smoke:hub
 *   (محتاج MySQL شغّالة على 127.0.0.1:3306؛ كلمة سر root في NAEEMAN_TEST_DB_PASSWORD لو فيه)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hub, waitForPort } from '../src/hub.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const serverDir = path.resolve(desktop, '../server');
const panelDir = path.join(desktop, 'app');
const customerDir = path.join(desktop, 'customer-app');

for (const dir of [panelDir, customerDir]) {
  if (!existsSync(path.join(dir, 'index.html'))) {
    console.error(`${path.basename(dir)} مش مبني — شغّل npm run build:client الأوّل`);
    process.exit(1);
  }
}

const require = createRequire(import.meta.url);
const electron = require('electron');
const mysql = createRequire(path.join(serverDir, 'package.json'))('mysql2/promise');
const database = `naeeman_smokehub_${process.pid}`;
const password = process.env.NAEEMAN_TEST_DB_PASSWORD ?? '';
const userData = mkdtempSync(path.join(tmpdir(), 'naeeman-smoke-hub-'));
const ports = { apiPort: 4130, customerPort: 4131 };
let code = 1;

try {
  // تجهيز القاعدة والمالك بنفس الكود اللي بتستعمله صفحة أوّل تشغيل
  const hub = new Hub({ serverDir, dataDir: path.join(userData, 'hub'), panelDir, customerDir });
  const config = await hub.initialize({ ...ports, mysql: { database, password } }, {
    shop: 'محل الاختبار', name: 'مالك', email: 'owner@smoke.local', password: 'Smoke-Test-Pass-2026',
  });
  writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ mode: 'hub', hub: { ...config, initialized: true } }));

  const result = spawnSync(electron, ['.'], {
    cwd: desktop,
    env: { ...process.env, NAEEMAN_SMOKE: '1', NAEEMAN_SMOKE_HUB: '1', NAEEMAN_USER_DATA: userData },
    encoding: 'utf8',
    timeout: 120_000,
  });
  const line = `${result.stdout}`.split('\n').find((text) => text.startsWith('SMOKE'));
  console.log(line ?? result.stderr?.slice(0, 2000) ?? 'مفيش رد');

  // البرنامج لازم يكون وقّف السيرفر وهو بيقفل
  const stillUp = await waitForPort(ports.apiPort, { timeoutMs: 800 }).then(() => true, () => false);
  if (stillUp) console.log('SMOKE_FAIL السيرفر لسه شغّال بعد ما البرنامج قفل');
  code = (result.status === 0 && !stillUp) ? 0 : 1;
} catch (error) {
  console.log(`SMOKE_FAIL ${error.message}`);
} finally {
  const connection = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password }).catch(() => null);
  await connection?.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await connection?.end();
  rmSync(userData, { recursive: true, force: true });
}
process.exit(code);
