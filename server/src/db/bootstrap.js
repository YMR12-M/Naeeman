/**
 * ═══════════════════════════════════════════════════════════════
 *  تهيئة أوّل تشغيل — لا بيانات تجريبية
 *
 *  هذا السكربت لا يخترع حلاقين ولا خدمات ولا أدوار. يفعل شيئًا واحدًا:
 *  ينشئ **المحل** (بقواعد الطابور الافتراضية) وحساب **المالك الأول**.
 *  بعد الدخول يكمّل المالك من التجهيز لأوّل مرّة في لوحة المحل
 *  (المواعيد · الخدمات · الحلاقين · ربط التلفزيون).
 *
 *  آمن للتكرار: لا يمسح شيئًا. إن وُجد مالك أخبرك وخرج.
 *
 *  التشغيل:   npm run db:bootstrap
 *  القيم من server/.env (SHOP_* / ADMIN_*) أو وسائط:
 *    npm run db:bootstrap -- --shop="صالون الأمل" --slug=elamal --name="اسمك" \
 *      --email=you@example.com --phone=01000000000 --password='كلمة-قوية-طويلة'
 * ═══════════════════════════════════════════════════════════════
 */
import crypto from 'node:crypto';
import { closePool, queryOne, transaction } from '../config/db.js';
import { hashPassword } from '../utils/security.js';
import { normalizePhone } from '../utils/phone.js';
import { logger } from '../utils/logger.js';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split('=');
      return [key.replace(/-/g, '_'), rest.length ? rest.join('=') : 'true'];
    }),
);

const pick = (key, envKey) => String(args[key] || process.env[envKey] || '').trim();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** كلمة مرور المالك تحمي كل شيء: حدّ أعلى من حدّ الموظفين */
function ownerPasswordIssues(password) {
  const issues = [];
  if (password.length < 12) issues.push('12 حرفًا على الأقل');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) issues.push('ثلاثة أنواع على الأقل من: حروف صغيرة، كبيرة، أرقام، رموز');
  if (/^(.)\1+$/.test(password)) issues.push('ليست حرفًا مكرّرًا');
  return issues;
}

/** اسم رابط عشوائي مقروء لو المالك ما حدّدش واحد (يتغيّر بعدين من الإعدادات) */
const randomSlug = () => `shop-${crypto.randomBytes(3).toString('hex')}`;

async function bootstrap() {
  const existingOwner = await queryOne("SELECT id, email FROM users WHERE role = 'owner' AND deleted_at IS NULL LIMIT 1");
  if (existingOwner) {
    logger.info(`يوجد مالك بالفعل (${existingOwner.email}) — مفيش حاجة اتعملت.`);
    logger.info('لإضافة موظفين: لوحة المحل › الفريق.');
    return;
  }

  const shopName = pick('shop', 'SHOP_NAME');
  const slug = (pick('slug', 'SHOP_SLUG') || randomSlug()).toLowerCase();
  const fullName = pick('name', 'ADMIN_NAME');
  const email = pick('email', 'ADMIN_EMAIL').toLowerCase();
  const phone = normalizePhone(pick('phone', 'ADMIN_PHONE'));
  const password = pick('password', 'ADMIN_PASSWORD');

  const missing = [];
  if (!shopName) missing.push('SHOP_NAME (أو --shop=)  اسم المحل');
  if (!fullName) missing.push('ADMIN_NAME (أو --name=)');
  if (!email) missing.push('ADMIN_EMAIL (أو --email=)');
  if (!password) missing.push('ADMIN_PASSWORD (أو --password=)');

  if (missing.length > 0) {
    logger.warn('اتوقّف — البيانات دي ناقصة:');
    missing.forEach((item) => console.log(`     ✗ ${item}`));
    console.log(`
  املأها في server/.env ثم أعد التشغيل، أو مرّرها مباشرة:

    npm run db:bootstrap -- \\
      --shop="اسم المحل" --slug=shop-name --name="اسمك" --email="you@example.com" \\
      --phone="01xxxxxxxxx" --password='كلمة-مرور-قوية-وطويلة'

  وبعد النجاح احذف ADMIN_PASSWORD من .env.
`);
    process.exitCode = 1;
    return;
  }

  if (!EMAIL_RE.test(email)) throw new Error(`بريد غير صالح: ${email}`);
  if (!SLUG_RE.test(slug) || slug.length < 3 || slug.length > 40) {
    throw new Error(`اسم الرابط غير صالح: ${slug} — حروف إنجليزي صغيرة وأرقام وشرطة (3 لـ 40 حرف)`);
  }
  const issues = ownerPasswordIssues(password);
  if (issues.length > 0) throw new Error(`كلمة مرور المالك ضعيفة — لازم:\n     • ${issues.join('\n     • ')}`);

  if (await queryOne('SELECT id FROM users WHERE email = ?', [email])) throw new Error(`البريد ${email} مستخدم بالفعل`);
  if (await queryOne('SELECT id FROM shops WHERE slug = ?', [slug])) throw new Error(`اسم الرابط ${slug} مستخدم بالفعل`);

  const passwordHash = await hashPassword(password);

  const { shopId, userId } = await transaction(async (tx) => {
    const shop = await tx.execute(
      'INSERT INTO shops (uuid, name, slug, checkin_secret) VALUES (?, ?, ?, ?)',
      [crypto.randomUUID(), shopName, slug, crypto.randomBytes(32).toString('hex')],
    );
    await tx.execute('INSERT INTO shop_settings (shop_id) VALUES (?)', [shop.insertId]);
    await tx.execute('INSERT INTO shop_state (shop_id) VALUES (?)', [shop.insertId]);
    const user = await tx.execute(
      `INSERT INTO users (uuid, shop_id, full_name, email, phone, password_hash, role, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'owner', NOW())`,
      [crypto.randomUUID(), shop.insertId, fullName, email, phone, passwordHash],
    );
    return { shopId: shop.insertId, userId: user.insertId };
  });

  logger.success(`اتعمل المحل «${shopName}» (#${shopId}، الرابط /${slug}) وحساب المالك ${email} (#${userId})`);
  console.log(`
  الخطوة الجاية: شغّل السيرفر وافتح لوحة المحل وادخل بالبريد ده،
  وهيفتح لك التجهيز لأوّل مرّة (المواعيد · الخدمات · الحلاقين · التلفزيون).
`);
}

try {
  await bootstrap();
} catch (error) {
  logger.error(error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
