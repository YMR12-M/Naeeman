/**
 * ═══════════════════════════════════════════════════════════════
 *  نعيمًا على كمبيوتر المحل (Electron)
 *
 *  • وضعين، بيتحدّدوا في أوّل تشغيل (setup.html):
 *      hub    الكمبيوتر ده هو سيرفر المحل: البرنامج بيشغّل MySQL والسيرفر في
 *             عمليات جانبية (hub.js). التلفزيون والكشك وتابلت الكرسي بيفتحوا
 *             http://<عنوان الكمبيوتر>:4030 على واي فاي المحل، وكل حاجة
 *             جوّه المحل شغّالة حتى لو النت قطع.
 *      remote سيرفر تاني (كمبيوتر في المحل أو Render).
 *  • اللوحة (client/dist) متشحونة جوّه البرنامج وبتتعرض من app://naeeman.
 *    أي طلب لـ /api بيعدّي من هنا لسيرفر المحل (net.fetch): مفيش CORS
 *    ولا كوكيز، والـ SSE بيوصل stream زي ما هو.
 *  • لو فيه شاشة تانية (التلفزيون)، بيفتح عليها /display ملء الشاشة لوحده،
 *    ولو اتشالت بيقفلها.
 *  • الإيصال بيتطبع على طابعة الإيصالات المختارة من غير نافذة (print:html).
 *  • الأمان: contextIsolation + sandbox، ومفيش تنقّل برّه app://، والروابط
 *    (واتساب مثلًا) بتفتح في المتصفّح العادي، وأوامر البرنامج بتقبل من
 *    صفحاته هو بس.
 * ═══════════════════════════════════════════════════════════════
 */
import {
  app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, screen, shell,
} from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeServerUrl, readConfig, session, writeConfig,
} from './config.js';
import { Hub, findMysqld, lanIp } from './hub.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const packaged = app.isPackaged;
// المتبنّي: اللوحة وتطبيق الزبون والسيرفر برّه الأرشيف (السيرفر بيقراهم بـ fs عادي)
const PANEL_DIR = packaged ? path.join(process.resourcesPath, 'panel') : path.resolve(here, '../app');
const CUSTOMER_DIR = packaged ? path.join(process.resourcesPath, 'customer-app') : path.resolve(here, '../customer-app');
const SERVER_DIR = packaged ? path.join(process.resourcesPath, 'server') : path.resolve(here, '../../server');
const ORIGIN = 'app://naeeman';
const smoke = process.env.NAEEMAN_SMOKE === '1';

// اختبار التشغيل ممكن يشتغل على بيانات مؤقّتة من غير ما يلمس بيانات المحل
if (process.env.NAEEMAN_USER_DATA) app.setPath('userData', process.env.NAEEMAN_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon',
};

let mainWindow = null;
let tvWindow = null;

const hub = new Hub({
  serverDir: SERVER_DIR,
  dataDir: path.join(app.getPath('userData'), 'hub'),
  panelDir: PANEL_DIR,
  customerDir: CUSTOMER_DIR,
  execPath: process.execPath,
  electron: true,
  mysqld: findMysqld({ resourcesPath: packaged ? process.resourcesPath : undefined, vendorDir: path.resolve(here, '../vendor') }),
});

const isHub = () => readConfig().mode === 'hub' && Boolean(readConfig().hub);

/** عنوان السيرفر اللي اللوحة بتكلّمه: نفس الكمبيوتر في وضع المحل، أو العنوان المحفوظ */
function serverUrl() {
  if (process.env.NAEEMAN_SERVER) return process.env.NAEEMAN_SERVER;
  const config = readConfig();
  if (config.mode === 'hub' && config.hub) return `http://127.0.0.1:${config.hub.apiPort}`;
  return config.serverUrl || null;
}

/** أوامر البرنامج بتقبل من صفحاته بس (اللوحة من app:// وصفحات الإعداد من file://) */
function fromOurPages(event) {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith(`${ORIGIN}/`) || url.startsWith('file:');
}

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
  let file = path.join(PANEL_DIR, relative);
  if (!file.startsWith(PANEL_DIR) || !existsSync(file) || !path.extname(file)) file = path.join(PANEL_DIR, 'index.html');
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

const setupPage = (error) => mainWindow?.loadFile(path.join(here, 'setup.html'), error ? { query: { error } } : undefined);

function createMain() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    title: 'نعيمًا', backgroundColor: '#A9D6C4', show: !smoke, webPreferences,
  });
  secure(mainWindow);
  mainWindow.on('closed', () => { mainWindow = null; });
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

/* ── الطباعة ─────────────────────────────────────────────────── */
/**
 * يطبع صفحة HTML (الإيصال) على الطابعة المختارة من غير نافذة. لو مفيش طابعة
 * مختارة بتظهر نافذة الطباعة العادية. طول الورقة بيتحسب من طول المحتوى
 * (رول الإيصالات مالوش طول ثابت).
 */
async function printHtml(html, { widthMm = 80 } = {}) {
  if (typeof html !== 'string' || html.length > 2_000_000) return { ok: false, message: 'الإيصال كبير قوي' };
  const width = Number(widthMm) === 58 ? 58 : 80;
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const heightPx = await window.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
    const heightMicrons = Math.max(100_000, Math.round(((heightPx * 25.4) / 96) * 1000) + 8_000);
    const printer = readConfig().printer || '';
    const outcome = await new Promise((resolve) => {
      window.webContents.print({
        silent: Boolean(printer),
        deviceName: printer || undefined,
        printBackground: false,
        margins: { marginType: 'none' },
        pageSize: { width: width * 1000, height: heightMicrons },
      }, (success, reason) => resolve({ success, reason }));
    });
    if (outcome.success || outcome.reason === 'cancelled') return { ok: true };
    return { ok: false, message: `الطباعة ما اشتغلتش (${outcome.reason || 'سبب مجهول'}) — اتأكد إن الطابعة شغّالة ومتوصّلة` };
  } catch (error) {
    return { ok: false, message: `الطباعة ما اشتغلتش: ${error.message}` };
  } finally {
    window.destroy();
  }
}

/* ── القايمة ─────────────────────────────────────────────────── */
function statusText() {
  const status = hub.status();
  const ip = status.ip ?? 'مفيش شبكة';
  const state = { running: 'شغّال', starting: 'بيشتغل…', failed: `واقف: ${status.error ?? ''}`, stopped: 'واقف' }[status.state] ?? status.state;
  return [
    `سيرفر المحل: ${state}`,
    '',
    `اللوحة والتلفزيون والكشك والكرسي (على واي فاي المحل):`,
    `http://${ip}:${status.apiPort}`,
    '',
    `تطبيق الزبون:`,
    `http://${ip}:${status.customerPort}`,
    '',
    `النسخ الاحتياطية: ${status.backupsDir}`,
  ].join('\n');
}

async function restartHub() {
  try {
    await hub.stop();
    await hub.start(readConfig().hub);
    mainWindow?.webContents.reload();
  } catch (error) {
    dialog.showErrorBox('نعيمًا', `السيرفر ما اشتغلش: ${error.message}`);
  }
}

async function buildMenu() {
  const printers = await (mainWindow?.webContents.getPrintersAsync() ?? Promise.resolve([])).catch(() => []);
  const chosen = readConfig().printer || '';
  const choosePrinter = (name) => { writeConfig({ printer: name }); buildMenu(); };

  const hubItems = isHub() ? [
    { type: 'separator' },
    { label: 'حالة سيرفر المحل…', click: () => dialog.showMessageBox({ type: 'info', title: 'سيرفر المحل', message: 'سيرفر المحل', detail: statusText(), buttons: ['تمام'] }) },
    { label: 'افتح فولدر النسخ الاحتياطية', click: () => shell.openPath(hub.backupsDir) },
    { label: 'سجلّ السيرفر', click: () => shell.showItemInFolder(hub.logFile) },
    {
      label: 'فولدر النسخ على السحابة…',
      click: async () => {
        const picked = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], title: 'فولدر Google Drive أو OneDrive' });
        if (picked.canceled || !picked.filePaths[0]) return;
        writeConfig({ hub: { ...readConfig().hub, backupCopyDir: picked.filePaths[0] } });
        await restartHub();
      },
    },
    { label: 'إعادة تشغيل السيرفر', click: restartHub },
  ] : [];

  const template = [
    {
      label: 'نعيمًا',
      submenu: [
        { label: 'سيرفر المحل…', click: () => setupPage() },
        {
          label: 'طابعة الإيصالات',
          submenu: [
            { label: 'اسألني كل مرّة (نافذة الطباعة)', type: 'radio', checked: !chosen, click: () => choosePrinter('') },
            ...printers.map((printer) => ({ label: printer.displayName || printer.name, type: 'radio', checked: chosen === printer.name, click: () => choosePrinter(printer.name) })),
          ],
        },
        { label: 'افتح شاشة التلفزيون هنا', click: () => { const win = new BrowserWindow({ width: 1280, height: 720, webPreferences }); secure(win); win.loadURL(`${ORIGIN}/display`); } },
        ...hubItems,
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

ipcMain.handle('print:html', (event, html, options) => (fromOurPages(event) ? printHtml(html, options) : { ok: false, message: 'مرفوض' }));
ipcMain.handle('hub:status', (event) => (fromOurPages(event) ? { hub: isHub(), ...hub.status() } : null));

ipcMain.handle('setup:state', (event) => {
  if (!fromOurPages(event)) return null;
  const config = readConfig();
  const query = event.senderFrame?.url ? new URL(event.senderFrame.url).searchParams : new URLSearchParams();
  return {
    mode: config.mode ?? (config.serverUrl ? 'remote' : null),
    serverUrl: config.serverUrl ?? '',
    hubInitialized: Boolean(config.hub?.initialized),
    mysqldAvailable: Boolean(hub.mysqld),
    ip: lanIp(),
    apiPort: config.hub?.apiPort ?? 4030,
    customerPort: config.hub?.customerPort ?? 4031,
    error: query.get('error') || '',
  };
});

ipcMain.handle('setup:pick-folder', async (event) => {
  if (!fromOurPages(event)) return null;
  const picked = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], title: 'فولدر Google Drive أو OneDrive' });
  return picked.canceled ? null : picked.filePaths[0] ?? null;
});

ipcMain.handle('setup:save', async (event, input) => {
  if (!fromOurPages(event)) return { ok: false, message: 'مرفوض' };
  const url = normalizeServerUrl(input);
  if (!url) return { ok: false, message: 'ده مش عنوان — مثال: 192.168.1.10:4030 أو https://api.example.com' };
  try {
    const response = await net.fetch(`${url}/health`);
    const body = await response.json().catch(() => null);
    if (body?.service !== 'naeeman-api') return { ok: false, message: 'العنوان ده شغّال بس مش سيرفر نعيمًا' };
  } catch {
    return { ok: false, message: 'مفيش رد من العنوان ده — اتأكد إن السيرفر شغّال وإن الكمبيوترين على نفس الشبكة' };
  }
  if (url !== readConfig().serverUrl || isHub()) session.clear(); // سيرفر تاني = جلسة تانية
  await hub.stop();
  writeConfig({ mode: 'remote', serverUrl: url });
  mainWindow?.loadURL(`${ORIGIN}/`);
  syncTv();
  buildMenu();
  return { ok: true };
});

/** الكمبيوتر ده هو السيرفر: تجهيز أوّل مرّة (لو لسه) ثم تشغيل */
ipcMain.handle('setup:hub', async (event, input = {}) => {
  if (!fromOurPages(event)) return { ok: false, message: 'مرفوض' };
  const saved = readConfig();
  try {
    let config = saved.hub;
    if (!saved.hub?.initialized) {
      await hub.stop();
      config = await hub.initialize(input.hub, input.owner);
      config = { ...config, initialized: true };
      writeConfig({ mode: 'hub', hub: config }); // اتحفظ قبل التشغيل: لو وقع التجهيز مش بيتكرّر
    }
    await hub.start(config);
    if (saved.mode !== 'hub') session.clear();
    writeConfig({ mode: 'hub', hub: config });
    mainWindow?.loadURL(`${ORIGIN}/`);
    syncTv();
    buildMenu();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

/* ── التشغيل ────────────────────────────────────────────────── */
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

async function boot() {
  const window = createMain();
  if (isHub()) {
    await window.loadFile(path.join(here, 'starting.html'));
    try {
      await hub.start(readConfig().hub);
    } catch (error) {
      await setupPage(`سيرفر المحل ما اشتغلش: ${error.message}`);
      return window;
    }
  }
  if (serverUrl()) window.loadURL(`${ORIGIN}/`);
  else await setupPage();
  return window;
}

app.whenReady().then(async () => {
  protocol.handle('app', handle);
  const window = await boot();
  await buildMenu();
  syncTv();
  screen.on('display-added', syncTv);
  screen.on('display-removed', syncTv);

  // اختبار تشغيل من غير شاشة: اللوحة اتحمّلت، والـ API بيرد من خلال app://
  if (smoke) {
    window.webContents.once('did-finish-load', async () => {
      try {
        const result = await window.webContents.executeJavaScript(
          `(async () => {
            const status = (await fetch('/api/v1/public/push-key')).status;
            const bridge = window.naeemanDesktop;
            const info = bridge ? await bridge.hubStatus() : null;
            return { title: document.title, status, desktop: Boolean(bridge), print: typeof bridge?.printHtml === 'function', hub: info?.hub ?? null, state: info?.state ?? null };
          })()`,
        );
        console.log(`SMOKE ${JSON.stringify({ ...result, url: window.webContents.getURL() })}`);
        const hubOk = process.env.NAEEMAN_SMOKE_HUB !== '1' || (result.hub === true && result.state === 'running');
        await hub.stop();
        app.exit(result.status === 200 && result.desktop && result.print && hubOk ? 0 : 1);
      } catch (error) {
        console.log(`SMOKE_FAIL ${error.message}`);
        await hub.stop();
        app.exit(1);
      }
    });
    // الصفحة ممكن تكون اتحمّلت قبل ما نسمع للحدث (وضع المحل بيستنى السيرفر)
    if (!window.webContents.isLoading() && window.webContents.getURL().startsWith(ORIGIN)) window.webContents.emit('did-finish-load');
  }
}).catch((error) => {
  dialog.showErrorBox('نعيمًا', `البرنامج ما اشتغلش: ${error.message}`);
  app.quit();
});

// المحل هو السيرفر: نقفل السيرفر والقاعدة بنضافة قبل ما البرنامج يقفل (عشان القاعدة ما تتلفش)
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting || (!hub.server && !hub.mysqlProcess)) return;
  event.preventDefault();
  quitting = true;
  hub.stop().finally(() => app.quit());
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) boot(); });
