/**
 * اختبار تشغيل البرنامج من غير ما نافذة تظهر: بيفتح اللوحة من app://،
 * وبيطلب /api/v1/public/push-key من جوّاها، ويتأكد إن الجسر موجود.
 *   NAEEMAN_SERVER=http://localhost:4030 npm run smoke
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

if (!existsSync(new URL('../app/index.html', import.meta.url))) {
  console.error('اللوحة مش مبنية — شغّل npm run build:client الأوّل');
  process.exit(1);
}
const electron = createRequire(import.meta.url)('electron');
const result = spawnSync(electron, ['.'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NAEEMAN_SMOKE: '1', NAEEMAN_SERVER: process.env.NAEEMAN_SERVER || 'http://localhost:4030' },
  encoding: 'utf8',
  timeout: 60_000,
});
const line = `${result.stdout}`.split('\n').find((text) => text.startsWith('SMOKE'));
console.log(line ?? result.stderr?.slice(0, 2000) ?? 'مفيش رد');
process.exit(result.status ?? 1);
