/**
 * يبني لوحة المحل (`client/`) وتطبيق الزبون (`mobile/`) وينسخهم في
 * `desktop/app/` و`desktop/customer-app/` عشان يتشحنوا جوّه البرنامج.
 *
 *  • اللوحة بتتعرض من `app://naeeman` من غير سيرفر ويب، وفي وضع «المحل هو
 *    السيرفر» السيرفر بيقدّمها هي وتطبيق الزبون للأجهزة على الواي فاي.
 *  • VITE_API_URL فاضي عمدًا: الواجهتين بتطلب `/api/v1` على نفس العنوان،
 *    والبرنامج (أو السيرفر) بيوصّلها.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

function build(source, target) {
  const dir = path.resolve(here, source);
  if (!existsSync(path.join(dir, 'node_modules'))) execSync('npm ci', { cwd: dir, stdio: 'inherit' });
  // بنشغّل Vite من ملفه مباشرة: node_modules/.bin ممكن يكون ناقص (symlinks بتضيع على iCloud)
  execSync(`"${process.execPath}" node_modules/vite/bin/vite.js build`, { cwd: dir, stdio: 'inherit', env: { ...process.env, VITE_API_URL: '' } });
  const out = path.resolve(here, target);
  rmSync(out, { recursive: true, force: true });
  cpSync(path.join(dir, 'dist'), out, { recursive: true });
  console.log(`✔ ${source} اتنسخ في ${path.relative(process.cwd(), out) || out}`);
}

build('../../client', '../app');
build('../../mobile', '../customer-app');
