/**
 * يبني لوحة المحل (`client/`) وينسخها في `desktop/app/` عشان تتشحن جوّه
 * البرنامج. البرنامج بيعرضها من `app://naeeman` من غير سيرفر ويب.
 *
 * VITE_API_URL فاضي عمدًا: اللوحة بتطلب `/api/v1` على نفس العنوان، والبرنامج
 * بيوصّلها لسيرفر المحل اللي اتحدّد في أوّل تشغيل.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.resolve(here, '../../client');
const target = path.resolve(here, '../app');

if (!existsSync(path.join(client, 'node_modules'))) execSync('npm ci', { cwd: client, stdio: 'inherit' });
execSync('npm run build', { cwd: client, stdio: 'inherit', env: { ...process.env, VITE_API_URL: '' } });

rmSync(target, { recursive: true, force: true });
cpSync(path.join(client, 'dist'), target, { recursive: true });
console.log(`✔ اللوحة اتنسخت في ${path.relative(process.cwd(), target) || target}`);
