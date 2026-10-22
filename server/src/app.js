/**
 * تركيب تطبيق Express.
 * ترتيب الـ middleware مقصود: الأمان ← التحليل ← السياق والسجلات ← المسارات ← الأخطاء.
 */
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

export function createApp() {
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

  // لوحة المحل وتطبيق الزبون والأجهزة: قائمة نطاقات صريحة + كوكي
  const strictCors = cors({
    origin: (origin, callback) => {
      // طلبات بلا Origin (أدوات المراقبة، curl) تمرّ
      if (!origin || env.clientOrigin.includes(origin)) return callback(null, true);
      return callback(new Error('CORS_NOT_ALLOWED'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Type', 'X-Request-Id', 'X-Device-Token', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
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

  // ── الأخطاء (آخر ما يُسجَّل دائمًا) ───────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
