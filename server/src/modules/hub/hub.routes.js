/**
 * ═══════════════════════════════════════════════════════════════
 *  «المحل هو السيرفر» — معلومات الشبكة والنسخ الاحتياطية (المالك بس)
 *
 *  • `GET /hub`: هل السيرفر شغّال في وضع المحل، وعناوين الواي فاي اللي
 *    التابلت والتلفزيون والكشك يفتحوها (اللوحة بتعمل منها QR).
 *  • النسخ: قايمة، ونسخة دلوقتي، واسترجاع (بيمسح البيانات الحالية).
 *
 *  برّه وضع المحل (Render/Docker) `GET /hub` بيرجّع enabled=false،
 *  والباقي بيرفض: النسخ هناك شغل قاعدة البيانات المُدارة.
 * ═══════════════════════════════════════════════════════════════
 */
import { networkInterfaces } from 'node:os';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { ok } from '../../utils/response.js';
import { audit } from '../../utils/audit.js';
import { createBackup, listBackups, restoreBackup } from '../../db/backup.js';

/** عناوين الشبكة المحلية (الأقرب لراوتر المحل الأوّل) */
export function lanAddresses(interfaces = networkInterfaces()) {
  const rank = (address) => (address.startsWith('192.168.') ? 0 : address.startsWith('10.') ? 1 : 2);
  const found = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (/^(lo|utun|awdl|llw|bridge|docker|veth|vmnet|vboxnet|br-)/i.test(name)) continue;
    for (const item of list ?? []) {
      const family = typeof item.family === 'string' ? item.family : `IPv${item.family}`;
      if (family !== 'IPv4' || item.internal) continue;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) found.push({ name, address: item.address });
    }
  }
  return found.sort((a, b) => rank(a.address) - rank(b.address));
}

const backupView = (backup) => ({ name: backup.name, bytes: backup.bytes, created_at: backup.created_at });

const restoreBody = z.object({
  name: z.string().trim().regex(/^naeeman-[\w.-]+\.json\.gz$/, 'اسم النسخة غلط'),
  confirm: z.literal(true, { errorMap: () => ({ message: 'لازم تأكّد الاسترجاع' }) }),
}).strict();

function requireHub() {
  if (!env.hubMode) throw ApiError.conflict('ده متاح لما المحل هو السيرفر بس', { code: 'HUB_ONLY' });
}

const router = Router();
router.use(authenticate, requirePermission('hub.manage'));

router.get('/', asyncHandler(async (req, res) => {
  const backups = env.hubMode ? await listBackups() : [];
  ok(res, {
    enabled: env.hubMode,
    addresses: env.hubMode ? lanAddresses() : [],
    api_port: env.port,
    customer_port: env.customerPort || null,
    serves_panel: Boolean(env.staticDir),
    serves_customer: Boolean(env.customerPort && env.customerStaticDir),
    backup: {
      enabled: env.backup.enabled,
      every_hours: env.backup.everyHours,
      keep: env.backup.keep,
      copy_dir: env.backup.copyDir || null,
      latest: backups[0] ? backupView(backups[0]) : null,
    },
  });
}));

router.get('/backups', asyncHandler(async (req, res) => {
  requireHub();
  ok(res, (await listBackups()).map(backupView));
}));

router.post('/backups', asyncHandler(async (req, res) => {
  requireHub();
  const result = await createBackup();
  await audit(req, { action: 'hub.backup', entity: 'backup', after: { file: result.file, bytes: result.bytes } });
  ok(res, { name: result.file.split(/[\\/]/).pop(), bytes: result.bytes, copied: Boolean(result.copied) });
}));

router.post('/backups/restore', validate({ body: restoreBody }), asyncHandler(async (req, res) => {
  requireHub();
  const backup = (await listBackups()).find((item) => item.name === req.body.name);
  if (!backup) throw ApiError.notFound('النسخة دي مش موجودة', { code: 'BACKUP_NOT_FOUND' });
  // نسخة من الحالة الحالية الأوّل: لو الاسترجاع كان غلط يبقى فيه رجوع
  const safety = await createBackup();
  const result = await restoreBackup(backup.file);
  await audit(req, { action: 'hub.restore', entity: 'backup', after: { name: backup.name, safety: safety.file.split(/[\\/]/).pop() } });
  ok(res, { restored: result.rows, name: backup.name, safety: safety.file.split(/[\\/]/).pop() });
}));

export default router;
