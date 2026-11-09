/* ============================================
   بناء النسخة التجريبية (عرض فقط) لـ Vercel

     node demo/build.mjs

   1) لوحة المحل (client) ← client/dist
   2) تطبيق الزبون (mobile) تحت /app ← client/dist/app
      (BrowserRouter بياخد basename="/app" وقت البناء بس، من غير تعديل في الكود)
   3) الباك إند التجريبي (demo/src) ← client/dist/demo-api.js، وبيتحط أوّل
      سكريبت في index.html بتاع الاتنين، فبيعترض /api/v1 قبل أي طلب.

   الرابط اللي بيتطبع في QR تطبيق الزبون من DEMO_ORIGIN (الافتراضي دومين Vercel).
   ============================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const origin = (process.env.DEMO_ORIGIN || 'https://naeeman.vercel.app').replace(/\/$/, '');
// DEMO_OUT: مجلد تاني للتجربة على الجهاز (من غير ما نلمس client/dist)
const dist = path.resolve(process.env.DEMO_OUT || path.join(root, 'client', 'dist'));

const load = (app, file) => import(pathToFileURL(path.join(root, app, 'node_modules', file)).href);

async function viteBuild(app, { outDir, base = '/', plugins = [] }) {
  const { build } = await load(app, 'vite/dist/node/index.js');
  await build({
    root: path.join(root, app),
    configFile: path.join(root, app, 'vite.config.js'),
    base,
    logLevel: 'warn',
    plugins,
    build: { outDir, emptyOutDir: true },
  });
}

/** basename للراوتر وقت البناء بس (تطبيق الزبون تحت /app) */
const basename = (prefix) => ({
  name: 'demo-router-basename',
  enforce: 'pre',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').endsWith('/src/main.jsx')) return null;
    if (!code.includes('<BrowserRouter>')) throw new Error('مش لاقي <BrowserRouter> في main.jsx');
    return code.replace('<BrowserRouter>', `<BrowserRouter basename="${prefix}">`);
  },
});

function inject(indexPath) {
  const html = fs.readFileSync(indexPath, 'utf8');
  if (html.includes('/demo-api.js')) return;
  // من غير defer ولا type=module عمدًا: لازم يشتغل قبل سكريبتات التطبيق
  fs.writeFileSync(indexPath, html.replace(/<head[^>]*>/i, (tag) => `${tag}\n    <script src="/demo-api.js"></script>`));
}

process.env.VITE_CUSTOMER_APP_URL = `${origin}/app`;

console.log('▸ لوحة المحل');
await viteBuild('client', { outDir: dist });

console.log('▸ تطبيق الزبون تحت /app');
await viteBuild('mobile', { outDir: path.join(dist, 'app'), base: '/app/', plugins: [basename('/app')] });

console.log('▸ الباك إند التجريبي');
const esbuildModule = await load('client', 'esbuild/lib/main.js');
const esbuild = esbuildModule.build ? esbuildModule : esbuildModule.default;
await esbuild.build({
  entryPoints: [path.join(here, 'src', 'naeeman', 'index.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020', 'safari14'],
  outfile: path.join(dist, 'demo-api.js'),
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

inject(path.join(dist, 'index.html'));
inject(path.join(dist, 'app', 'index.html'));
console.log(`✅ النسخة التجريبية جاهزة في ${path.relative(root, dist)} (${origin})`);
