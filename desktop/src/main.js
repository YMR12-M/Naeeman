/**
 * ═══════════════════════════════════════════════════════════════
 *  نعيمًا على كمبيوتر المحل (Electron)
 *
 *  • اللوحة (client/dist) متشحونة جوّه البرنامج وبتتعرض من app://naeeman.
 *    أي طلب لـ /api بيعدّي من هنا لسيرفر المحل (net.fetch): مفيش CORS
 *    ولا كوكيز، والـ SSE بيوصل stream زي ما هو.
 *  • لو فيه شاشة تانية (التلفزيون)، بيفتح عليها /display ملء الشاشة لوحده،
 *    ولو اتشالت بيقفلها.
 *  • أوّل تشغيل: صفحة صغيرة تسأل عن عنوان السيرفر وتجرّبه.
 *  • الأمان: contextIsolation + sandbox، ومفيش تنقّل برّه app://، والروابط
 *    (واتساب مثلًا) بتفتح في المتصفّح العادي.
 * ═══════════════════════════════════════════════════════════════
 */
import {
  app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, screen, shell,
} from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeServerUrl, readConfig, session, writeConfig } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(here, '../app');
const ORIGIN = 'app://naeeman';
const smoke = process.env.NAEEMAN_SMOKE === '1';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon',
};

let mainWindow = null;
let tvWindow = null;

const serverUrl = () => process.env.NAEEMAN_SERVER || readConfig().serverUrl || null;

/* ── app:// — ملفات اللوحة + تحويل /api للسيرفر ─────────────── */
async function handle(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    const server = serverUrl();
    if (!server) return new Response('{"success":false,"message":"سيرفر المحل مش متحدّد"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
    const headers = new Headers(request.headers);
    headers.delete('origin'); // الطلب طالع من البرنامج نفسه، مش من موقع
    headers.delete('cookie');
    return net.fetch(`${server}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      duplex: 'half',
    }).catch(() => new Response('{"success":false,"message":"السيرفر مش بيرد — اتأكد إن كمبيوتر السيرفر شغّال والنت متوصّل"}', {
      status: 502, headers: { 'Content-Type': 'application/json' },
    }));
  }

  // ملف من اللوحة، وأي مسار تاني (/display، /queue…) = index.html (تطبيق صفحة واحدة)
  const relative = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = path.join(APP_DIR, relative);
  if (!file.startsWith(APP_DIR) || !existsSync(file) || !path.extname(file)) file = path.join(APP_DIR, 'index.html');
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  return new Response(readFileSync(file), { headers: { 'Content-Type': type } });
}

/* ── النوافذ ─────────────────────────────────────────────────── */
function secure(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN) && !url.startsWith('file:')) event.preventDefault();
  });
}

const webPreferences = {
  preload: path.join(here, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

function createMain() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    title: 'نعيمًا', backgroundColor: '#A9D6C4', show: !smoke, webPreferences,
  });
  secure(mainWindow);
  mainWindow.on('closed', () => { mainWindow = null; });
  if (serverUrl()) mainWindow.loadURL(`${ORIGIN}/`);
  else mainWindow.loadFile(path.join(here, 'setup.html'));
  return mainWindow;
}

/** التلفزيون: أوّل شاشة مش الأساسية، ملء الشاشة على /display */
function syncTv() {
  if (!serverUrl()) return;
  const primary = screen.getPrimaryDisplay();
  const external = screen.getAllDisplays().find((display) => display.id !== primary.id);
  if (!external) {
    tvWindow?.close();
    return;
  }
  if (tvWindow) return;
  const { x, y, width, height } = external.bounds;
  tvWindow = new BrowserWindow({
    x, y, width, height, fullscreen: true, frame: false, autoHideMenuBar: true,
    title: 'نعيمًا — التلفزيون', backgroundColor: '#A9D6C4', show: !smoke, webPreferences,
  });
  secure(tvWindow);
  tvWindow.on('closed', () => { tvWindow = null; });
  tvWindow.loadURL(`${ORIGIN}/display`);
}

function buildMenu() {
  const template = [
    {
      label: 'نعيمًا',
      submenu: [
        { label: 'سيرفر المحل…', click: () => mainWindow?.loadFile(path.join(here, 'setup.html')) },
        { label: 'افتح شاشة التلفزيون هنا', click: () => { const win = new BrowserWindow({ width: 1280, height: 720, webPreferences }); secure(win); win.loadURL(`${ORIGIN}/display`); } },
        { type: 'separator' },
        { role: 'reload', label: 'تحديث' },
        { role: 'togglefullscreen', label: 'ملء الشاشة' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'أدوات المطوّر' }]),
        { type: 'separator' },
        { role: 'quit', label: 'خروج' },
      ],
    },
    { label: 'تعديل', submenu: [{ role: 'undo', label: 'تراجع' }, { role: 'redo', label: 'إعادة' }, { type: 'separator' }, { role: 'cut', label: 'قص' }, { role: 'copy', label: 'نسخ' }, { role: 'paste', label: 'لصق' }, { role: 'selectAll', label: 'تحديد الكل' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ── الجسر ──────────────────────────────────────────────────── */
ipcMain.handle('session:get', () => session.get());
ipcMain.handle('session:set', (_event, token) => { if (typeof token === 'string' && token.length < 400) session.set(token); });
ipcMain.handle('session:clear', () => session.clear());
ipcMain.handle('setup:current', () => serverUrl());
ipcMain.handle('setup:save', async (_event, input) => {
  const url = normalizeServerUrl(input);
  if (!url) return { ok: false, message: 'ده مش عنوان — مثال: 192.168.1.10:4030 أو https://api.example.com' };
  try {
    const response = await net.fetch(`${url}/health`);
    const body = await response.json().catch(() => null);
    if (body?.service !== 'naeeman-api') return { ok: false, message: 'العنوان ده شغّال بس مش سيرفر نعيمًا' };
  } catch {
    return { ok: false, message: 'مفيش رد من العنوان ده — اتأكد إن السيرفر شغّال وإن الكمبيوترين على نفس الشبكة' };
  }
  if (url !== readConfig().serverUrl) session.clear(); // سيرفر تاني = جلسة تانية
  writeConfig({ serverUrl: url });
  mainWindow?.loadURL(`${ORIGIN}/`);
  syncTv();
  return { ok: true };
});

/* ── التشغيل ────────────────────────────────────────────────── */
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

app.whenReady().then(async () => {
  protocol.handle('app', handle);
  buildMenu();
  const window = createMain();
  syncTv();
  screen.on('display-added', syncTv);
  screen.on('display-removed', syncTv);

  // اختبار تشغيل من غير شاشة: اللوحة اتحمّلت، والـ API بيرد من خلال app://
  if (smoke) {
    window.webContents.once('did-finish-load', async () => {
      try {
        const result = await window.webContents.executeJavaScript(
          "fetch('/api/v1/public/push-key').then((r) => r.status).then((status) => ({ title: document.title, status, desktop: Boolean(window.naeemanDesktop) }))",
        );
        console.log(`SMOKE ${JSON.stringify({ ...result, url: window.webContents.getURL() })}`);
        app.exit(result.status === 200 && result.desktop ? 0 : 1);
      } catch (error) {
        console.log(`SMOKE_FAIL ${error.message}`);
        app.exit(1);
      }
    });
  }
}).catch((error) => {
  dialog.showErrorBox('نعيمًا', `البرنامج ما اشتغلش: ${error.message}`);
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMain(); });

