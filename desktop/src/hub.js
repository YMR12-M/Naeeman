/**
 * ═══════════════════════════════════════════════════════════════
 *  «المحل هو السيرفر» — تشغيل سيرفر نعيمًا على كمبيوتر المحل
 *
 *  البرنامج بيشغّل (في عمليات جانبية، ومن غير ما يظهر للموظف حاجة):
 *   1. MySQL — المتشحونة مع البرنامج (`mysql/bin/mysqld` جوّه الموارد) لو
 *      موجودة، وإلا MySQL المتسطّبة على الجهاز (عنوان وبورت وحساب).
 *   2. سيرفر نعيمًا نفسه، بنفس الكود اللي على Render، بمتغيّرات بيئة
 *      بيطلعها البرنامج (HUB_MODE): بيقدّم اللوحة وشاشات الأجهزة على
 *      البورت 4030 وتطبيق الزبون على 4031، لكل الشبكة.
 *
 *  الملف ده Node عادي من غير `electron`: بيتجرّب بـ `node --test`.
 *  العمليات بتتشغّل بـ `execPath` (جوّه Electron بيكون ملف البرنامج نفسه
 *  ومعاه ELECTRON_RUN_AS_NODE، فمفيش Node منفصل يتسطّب).
 * ═══════════════════════════════════════════════════════════════
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { networkInterfaces } from 'node:os';
import net from 'node:net';
import path from 'node:path';

export const HUB_DEFAULTS = Object.freeze({
  apiPort: 4030,
  customerPort: 4031,
  mysql: { mode: 'external', host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'naeeman' },
  backupCopyDir: '',
});

/* ═══════════════════ التحقّق من اللي المالك كتبه ═══════════════════ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DB_NAME_RE = /^[A-Za-z0-9_]{1,48}$/;

/** نفس شرط السيرفر (server/src/db/bootstrap.js) عشان الرفض يبقى قبل ما نشغّل حاجة */
export function ownerPasswordIssues(password) {
  const issues = [];
  if (String(password).length < 12) issues.push('12 حرفًا على الأقل');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) issues.push('ثلاثة أنواع على الأقل من: حروف صغيرة، كبيرة، أرقام، رموز');
  if (/^(.)\1+$/.test(password)) issues.push('مش حرف متكرّر');
  return issues;
}

const port = (value, fallback) => {
  const number = value === undefined || value === '' ? fallback : Number(value);
  return Number.isInteger(number) && number >= 1024 && number <= 65535 ? number : null;
};

/**
 * إعدادات وضع المحل كما كتبها المالك ← إعدادات كاملة، أو قايمة أخطاء.
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function normalizeHub(input = {}) {
  const errors = [];
  const apiPort = port(input.apiPort, HUB_DEFAULTS.apiPort);
  const customerPort = port(input.customerPort, HUB_DEFAULTS.customerPort);
  if (apiPort === null) errors.push('بورت اللوحة لازم رقم بين 1024 و65535');
  if (customerPort === null) errors.push('بورت تطبيق الزبون لازم رقم بين 1024 و65535');
  if (apiPort !== null && apiPort === customerPort) errors.push('بورت اللوحة وبورت تطبيق الزبون لازم يختلفوا');

  const my = input.mysql ?? {};
  const mode = my.mode === 'bundled' ? 'bundled' : 'external';
  const mysqlPort = port(my.port, mode === 'bundled' ? 3307 : HUB_DEFAULTS.mysql.port);
  if (mysqlPort === null) errors.push('بورت MySQL غلط');
  const database = String(my.database || HUB_DEFAULTS.mysql.database).trim();
  if (!DB_NAME_RE.test(database)) errors.push('اسم القاعدة حروف إنجليزي وأرقام و_ بس');
  const mysql = {
    mode,
    host: mode === 'bundled' ? '127.0.0.1' : String(my.host || HUB_DEFAULTS.mysql.host).trim(),
    port: mysqlPort,
    user: mode === 'bundled' ? 'root' : String(my.user || HUB_DEFAULTS.mysql.user).trim(),
    // MySQL المتشحونة: كلمة سر root بتتولّد لوحدها أوّل مرّة وبتتحفظ مع الإعدادات
    password: String(my.password ?? '') || (mode === 'bundled' ? randomBytes(18).toString('base64url') : ''),
    database,
  };
  if (!mysql.host) errors.push('عنوان MySQL مطلوب');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      apiPort,
      customerPort,
      mysql,
      backupCopyDir: String(input.backupCopyDir ?? '').trim(),
      secret: input.secret || randomBytes(48).toString('base64url'),
    },
  };
}

/** بيانات المحل والمالك لأوّل تشغيل */
export function normalizeOwner(input = {}) {
  const errors = [];
  const shop = String(input.shop ?? '').trim();
  const name = String(input.name ?? '').trim();
  const email = String(input.email ?? '').trim().toLowerCase();
  const password = String(input.password ?? '');
  const slug = String(input.slug ?? '').trim().toLowerCase();
  if (shop.length < 2) errors.push('اكتب اسم المحل');
  if (name.length < 2) errors.push('اكتب اسمك');
  if (!EMAIL_RE.test(email)) errors.push('البريد مش مظبوط');
  const issues = ownerPasswordIssues(password);
  if (issues.length) errors.push(`كلمة السر: ${issues.join('، ')}`);
  if (slug && !SLUG_RE.test(slug)) errors.push('اسم الرابط حروف إنجليزي صغيرة وأرقام وشرطة بس');
  return errors.length ? { ok: false, errors } : { ok: true, value: { shop, name, email, password, slug, phone: String(input.phone ?? '').trim() } };
}

/* ═══════════════════ الشبكة ═══════════════════ */

/** أنسب عنوان على شبكة المحل (192.168 أوّلًا) أو null */
export function lanIp(interfaces = networkInterfaces()) {
  const rank = (address) => (address.startsWith('192.168.') ? 0 : address.startsWith('10.') ? 1 : 2);
  const found = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (/^(lo|utun|awdl|llw|bridge|docker|veth|vmnet|vboxnet|br-)/i.test(name)) continue;
    for (const item of list ?? []) {
      const family = typeof item.family === 'string' ? item.family : `IPv${item.family}`;
      if (family === 'IPv4' && !item.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) found.push(item.address);
    }
  }
  return found.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

export function waitForPort(portNumber, { host = '127.0.0.1', timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port: portNumber, host });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`البورت ${portNumber} ما فتحش`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function waitForHealth(portNumber, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'مفيش رد';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/health`, { signal: AbortSignal.timeout(2_000) });
      const body = await response.json().catch(() => null);
      if (body?.service === 'naeeman-api') return;
      last = `رد غريب (${response.status})`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => { setTimeout(resolve, 400); });
  }
  throw new Error(`السيرفر ما قامش في الوقت: ${last}`);
}

/** MySQL المتشحونة: لو الملف موجود جوّه الموارد أو في المتغيّر */
export function findMysqld({ resourcesPath, vendorDir, env = process.env } = {}) {
  const exe = process.platform === 'win32' ? 'mysqld.exe' : 'mysqld';
  const candidates = [
    env.NAEEMAN_MYSQLD,
    resourcesPath && path.join(resourcesPath, 'mysql', 'bin', exe),
    vendorDir && path.join(vendorDir, 'mysql', 'bin', exe),
  ].filter(Boolean);
  return candidates.find((file) => existsSync(file)) ?? null;
}

/* ═══════════════════ التشغيل ═══════════════════ */

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export class Hub {
  /**
   * @param {object} options
   * @param {string} options.serverDir  فولدر `server/` (فيه src و node_modules)
   * @param {string} options.dataDir    فولدر بيانات البرنامج (قاعدة، نسخ، صور، لوج)
   * @param {string} options.panelDir   لوحة المحل المبنية
   * @param {string} [options.customerDir] تطبيق الزبون المبني
   * @param {string} [options.execPath] اللي بيشغّل ملفات Node (الافتراضي: Node الحالي)
   * @param {boolean} [options.electron] true جوّه Electron (بيضيف ELECTRON_RUN_AS_NODE)
   * @param {string|null} [options.mysqld] مسار mysqld المتشحون
   */
  constructor({ serverDir, dataDir, panelDir, customerDir = '', execPath = process.execPath, electron = false, mysqld = null, onEvent = () => {} }) {
    Object.assign(this, { serverDir, dataDir, panelDir, customerDir, execPath, electron, mysqld, onEvent });
    this.config = null;
    this.server = null;
    this.mysqlProcess = null;
    this.stopping = false;
    this.restarts = [];
    this.state = 'stopped'; // stopped | starting | running | failed
    this.error = null;
  }

  get logFile() { return path.join(this.dataDir, 'logs', 'server.log'); }
  get backupsDir() { return path.join(this.dataDir, 'backups'); }

  log(line) {
    try {
      mkdirSync(path.dirname(this.logFile), { recursive: true });
      if (existsSync(this.logFile) && statSync(this.logFile).size > MAX_LOG_BYTES) rmSync(this.logFile, { force: true });
      appendFileSync(this.logFile, `${new Date().toISOString()} ${line}\n`);
    } catch { /* اللوج مش هيوقّف الشغل */ }
  }

  setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.onEvent({ state, error });
  }

  status() {
    return {
      state: this.state,
      error: this.error,
      ip: lanIp(),
      apiPort: this.config?.apiPort ?? null,
      customerPort: this.config?.customerPort ?? null,
      mysql: this.config ? { mode: this.config.mysql.mode, port: this.config.mysql.port } : null,
      logFile: this.logFile,
      backupsDir: this.backupsDir,
    };
  }

  /** متغيّرات بيئة السيرفر (نفس .env بس بيطلعها البرنامج) */
  serverEnv(config = this.config) {
    const ip = lanIp() ?? '127.0.0.1';
    return {
      NODE_ENV: 'production',
      HUB_MODE: 'true',
      HOST: '0.0.0.0',
      PORT: String(config.apiPort),
      CUSTOMER_PORT: String(config.customerPort),
      STATIC_DIR: this.panelDir,
      CUSTOMER_STATIC_DIR: this.customerDir,
      API_PUBLIC_URL: `http://${ip}:${config.apiPort}`,
      APP_URL: `http://${ip}:${config.apiPort}`,
      CUSTOMER_APP_URL: `http://${ip}:${config.customerPort}`,
      DB_HOST: config.mysql.host,
      DB_PORT: String(config.mysql.port),
      DB_USER: config.mysql.user,
      DB_PASSWORD: config.mysql.password,
      DB_NAME: config.mysql.database,
      JWT_ACCESS_SECRET: config.secret,
      UPLOADS_DIR: path.join(this.dataDir, 'uploads'),
      BACKUP_DIR: this.backupsDir,
      BACKUP_COPY_DIR: config.backupCopyDir || '',
      BACKUP_ENABLED: 'true',
      COOKIE_SECURE: 'false',
    };
  }

  spawnNode(args, env, { cwd = this.serverDir } = {}) {
    return spawn(this.execPath, args, {
      cwd,
      env: { ...process.env, ...(this.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }

  /** سكربت قصير (migrate / bootstrap) لحد ما يخلص */
  runScript(script, args, env) {
    return new Promise((resolve, reject) => {
      const child = this.spawnNode([path.join(this.serverDir, script), ...args], env);
      let output = '';
      const take = (chunk) => { output += chunk; this.log(String(chunk).trimEnd()); };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      child.once('error', reject);
      child.once('close', (code) => (code === 0 ? resolve(output) : reject(new Error(output.trim().split('\n').slice(-8).join('\n') || `الأمر خلص بكود ${code}`))));
    });
  }

  /* ── MySQL المتشحونة ── */
  async startMysql(config) {
    if (config.mysql.mode !== 'bundled') return;
    if (!this.mysqld) throw new Error('MySQL المتشحونة مش موجودة في البرنامج ده — اختار «MySQL على الجهاز»');
    const datadir = path.join(this.dataDir, 'mysql');
    const common = [`--datadir=${datadir}`, `--port=${config.mysql.port}`, '--bind-address=127.0.0.1', '--mysqlx=OFF'];
    if (process.platform !== 'win32') common.push(`--socket=${path.join(this.dataDir, 'mysql.sock')}`, `--pid-file=${path.join(this.dataDir, 'mysql.pid')}`);

    if (!existsSync(path.join(datadir, 'mysql'))) {
      mkdirSync(datadir, { recursive: true });
      // كلمة سر root بتتحط وقت التجهيز (ملف مؤقّت بيتمسح)
      const init = path.join(this.dataDir, 'mysql-init.sql');
      writeFileSync(init, `ALTER USER 'root'@'localhost' IDENTIFIED BY '${config.mysql.password.replace(/'/g, "''")}';\n`, { mode: 0o600 });
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(this.mysqld, [`--initialize-insecure`, `--init-file=${init}`, ...common.filter((arg) => !arg.startsWith('--socket') && !arg.startsWith('--pid-file'))], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
          let output = '';
          child.stdout.on('data', (chunk) => { output += chunk; });
          child.stderr.on('data', (chunk) => { output += chunk; });
          child.once('error', reject);
          child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`تجهيز MySQL فشل: ${output.trim().split('\n').slice(-5).join(' | ')}`))));
        });
      } finally {
        rmSync(init, { force: true });
      }
    }

    this.mysqlProcess = spawn(this.mysqld, common, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.mysqlProcess.stderr.on('data', (chunk) => this.log(`[mysql] ${String(chunk).trimEnd()}`));
    this.mysqlProcess.once('close', (code) => { this.log(`[mysql] وقف (${code})`); this.mysqlProcess = null; });
    await waitForPort(config.mysql.port, { timeoutMs: 60_000 });
  }

  /**
   * أوّل تشغيل: قاعدة البيانات والجداول وبيانات المحل والمالك. بتتكرّر من غير
   * ضرر (لو المالك موجود بيسيبه زي ما هو).
   */
  async initialize(hubConfig, owner) {
    const checked = normalizeHub(hubConfig);
    if (!checked.ok) throw new Error(checked.errors.join(' — '));
    const who = normalizeOwner(owner);
    if (!who.ok) throw new Error(who.errors.join(' — '));
    this.config = checked.value;
    this.setState('starting');
    try {
      mkdirSync(this.dataDir, { recursive: true });
      await this.startMysql(this.config);
      const env = this.serverEnv();
      await this.runScript('src/db/migrate.js', ['up'], env);
      await this.runScript('src/db/bootstrap.js', [], {
        ...env,
        SHOP_NAME: who.value.shop,
        SHOP_SLUG: who.value.slug,
        ADMIN_NAME: who.value.name,
        ADMIN_EMAIL: who.value.email,
        ADMIN_PHONE: who.value.phone,
        ADMIN_PASSWORD: who.value.password,
      });
    } catch (error) {
      await this.stop();
      this.setState('failed', error.message);
      throw error;
    }
    return this.config;
  }

  /** تشغيل السيرفر (والقاعدة لو متشحونة) والرقابة عليه */
  async start(hubConfig) {
    const checked = normalizeHub(hubConfig);
    if (!checked.ok) throw new Error(checked.errors.join(' — '));
    this.config = checked.value;
    this.stopping = false;
    this.setState('starting');
    try {
      mkdirSync(this.dataDir, { recursive: true });
      if (!this.mysqlProcess) await this.startMysql(this.config);
      // أي تحديث للبرنامج بيحدّث شكل القاعدة قبل ما السيرفر يقوم
      await this.runScript('src/db/migrate.js', ['up'], this.serverEnv());
      this.spawnServer();
      await waitForHealth(this.config.apiPort);
      this.setState('running');
    } catch (error) {
      await this.stop();
      this.setState('failed', error.message);
      throw error;
    }
  }

  spawnServer() {
    const child = this.spawnNode([path.join(this.serverDir, 'src/server.js')], this.serverEnv());
    this.server = child;
    const take = (chunk) => this.log(String(chunk).replace(/\u001b\[[0-9;]*m/g, '').trimEnd());
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.once('error', (error) => this.log(`[server] ${error.message}`));
    child.once('close', (code) => {
      this.server = null;
      if (this.stopping) return;
      this.log(`[server] وقف فجأة (${code})`);
      // لو وقع أكتر من 5 مرّات في دقيقتين نبطّل نلفّ ونقول إنه فشل
      const now = Date.now();
      this.restarts = this.restarts.filter((time) => now - time < 120_000);
      if (this.restarts.length >= 5) {
        this.setState('failed', 'السيرفر بيقع كل شوية — شوف سجلّ السيرفر');
        return;
      }
      this.restarts.push(now);
      this.setState('starting');
      setTimeout(() => {
        if (this.stopping) return;
        this.spawnServer();
        waitForHealth(this.config.apiPort).then(() => this.setState('running')).catch((error) => this.setState('failed', error.message));
      }, 1_500);
    });
  }

  async stop() {
    this.stopping = true;
    const wait = (child, ms) => new Promise((resolve) => {
      if (!child || child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, ms);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
    const server = this.server;
    const mysql = this.mysqlProcess;
    server?.kill('SIGTERM');
    await wait(server, 10_000);
    mysql?.kill('SIGTERM');
    await wait(mysql, 30_000);
    this.server = null;
    this.mysqlProcess = null;
    if (this.state !== 'failed') this.state = 'stopped';
  }
}
