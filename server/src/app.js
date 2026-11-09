/**
 * تركيب تطبيق Express.
 * ترتيب الـ middleware مقصود: الأمان ← التحليل ← السياق والسجلات ← المسارات ← الأخطاء.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import './config/zod.js';
import { env } from './config/env.js';
import { query } from './config/db.js';
import apiRoutes from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestContext } from './middleware/requestContext.js';
import { generalLimiter } from './middleware/rateLimiters.js';

/**
 * الواجهة (تطبيق صفحة واحدة) من فولدر مبني: الملفات زي ما هي، وأي مسار
 * تاني مش API = index.html. ملفات assets ليها hash في اسمها فبتتخزّن سنة،
 * وindex.html ما بيتخزّنش عشان النسخة الجديدة توصل أوّل ما تنزل.
 */
function serveSpa(app, dir) {
  const root = path.resolve(dir);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) throw new Error(`مفيش index.html في ${root} — ابني الواجهة الأول (npm run build)`);
  app.use(express.static(root, {
    index: false,
    setHeaders: (res, file) => {
      res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  app.get(/^(?!\/api\/|\/health).*/, (req, res, next) => {
    if (!req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(index);
  });
}

/**
 * @param {object} [options]
 * @param {string} [options.staticDir]  فولدر واجهة مبنية يقدّمها السيرفر نفسه (وضع المحل)
 */
export function createApp({ staticDir = env.staticDir } = {}) {
  const app = express();

  // خلف Nginx/Cloudflare/Render نحتاج ثقة البروكسي ليصل req.ip صحيحًا
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.disable('etag');

  // ── الأمان ───────────────────────────────────────────────
  app.use(helmet({
    // صور الحلاقين تُقرأ من نطاق الواجهة لا من نطاق الـ API
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // سياسة المحتوى تُضبط على الواجهة حيث تُقدَّم الصفحة
    contentSecurityPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  // لوحة المحل وتطبيق الزبون والأجهزة: قائمة نطاقات صريحة + كوكي.
  // والطلب من نفس العنوان اللي السيرفر شغّال عليه مسموح دايمًا: التابلت
  // بيفتح عنوان الواي فاي (192.168.1.10:4030) واللي ممكن يتغيّر.
  const strictOptions = {
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Type', 'X-Request-Id', 'X-Device-Token', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  };
  const sameOrigin = (req, origin) => {
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  };
  const strictCors = cors((req, callback) => {
    const { origin } = req.headers;
    // طلبات بلا Origin (أدوات المراقبة، curl، برنامج الديسكتوب) تمرّ
    if (!origin || env.clientOrigin.includes(origin) || sameOrigin(req, origin)) {
      return callback(null, { ...strictOptions, origin: true });
    }
    return callback(new Error('CORS_NOT_ALLOWED'));
  });

  // صفحة المحل العامة: أي موقع يقدر يعرض «قدّامك كام» — لكن بلا كوكي أبدًا
  const openCors = cors({
    origin: true,
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  });
  const openPrefixes = [`${env.apiPrefix}/public`];
  app.use((req, res, next) => (openPrefixes.some((prefix) => req.path.startsWith(prefix)) ? openCors : strictCors)(req, res, next));

  // ── تحليل الطلب ──────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(compression());
  app.use(requestContext);
  if (!env.isProd && !env.isTest) app.use(morgan('dev'));

  // ── فحص الصحّة (قبل حدّ المعدّل ليعمل مع أدوات المراقبة) ──
  app.get('/health', (_req, res) => res.json({
    success: true,
    status: 'ok',
    service: 'naeeman-api',
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));

  app.get('/health/ready', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ success: true, status: 'ready' });
    } catch {
      res.status(503).json({ success: false, status: 'database_unavailable' });
    }
  });

  // ── مسارات الـ API ───────────────────────────────────────
  app.use(env.apiPrefix, generalLimiter, apiRoutes);

  // ── الواجهة نفسها (وضع المحل أو Docker من غير nginx) ─────
  if (staticDir) serveSpa(app, staticDir);

  // ── الأخطاء (آخر ما يُسجَّل دائمًا) ───────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
