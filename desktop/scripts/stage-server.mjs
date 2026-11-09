/**
 * يجهّز السيرفر للتغليف: كود `server/src` وتبعيات الإنتاج بس (من غير
 * الاختبارات ولا تبعيات التطوير) في `desktop/server-stage/`، و`electron-builder`
 * بينسخه جوّه موارد البرنامج (`resources/server`) برّه الأرشيف.
 */
import { execSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.resolve(here, '../../server');
const stage = path.resolve(here, '../server-stage');

rmSync(stage, { recursive: true, force: true });
cpSync(path.join(server, 'src'), path.join(stage, 'src'), { recursive: true });
for (const name of ['package.json', 'package-lock.json']) cpSync(path.join(server, name), path.join(stage, name));
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: stage, stdio: 'inherit' });
console.log(`✔ السيرفر اتجهّز في ${path.relative(process.cwd(), stage) || stage}`);
