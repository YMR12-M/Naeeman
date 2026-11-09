/**
 * ═══════════════════════════════════════════════════════════════
 *  كارت الزبون في المحل
 *
 *  كارت لكل زبون في كل محل. `linkCard` هي الوحيدة اللي بتعمل كارت (وقت
 *  أخد الدور، أو فاتورة بيع باسم زبون):
 *    • حساب التطبيق ← كارت الحساب في المحل ده (أو كارت جديد من غير رقم).
 *    • زبون الشارع والكشك ← كارت الموبايل (بالرقم اللي اتكتب).
 *  زبون من غير حساب ولا موبايل مالوش كارت.
 *
 *  رقم الحساب مش متأكّد منه (مفيش SMS)، فالحساب ما بيترَبطش لوحده بكارت
 *  الموبايل القديم: الاستقبال بيطلّع كود (`issueLinkCode`) وهو شايف صاحب
 *  الكارت، والزبون بيكتبه في التطبيق (`customerCards.linkWithCode`)،
 *  والكارتين بيتدمجوا في كارت واحد.
 * ═══════════════════════════════════════════════════════════════
 */
import crypto from 'node:crypto';
import { query, queryOne, execute, transaction, isDuplicate } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { pageMeta } from '../../utils/response.js';
import { readPhoto, removePhoto, savePhoto } from '../../utils/storage.js';
import { sha256 } from '../../utils/security.js';
import { loadSettings } from '../shop/shop.service.js';

const CARD_COLUMNS = `id, shop_id, customer_id, phone, name, notes, stamps, rewards_redeemed, visits, total_spent,
  first_visit_at, last_visit_at, last_barber_id, reminded_at, reminders_off, created_at, updated_at`;

const shapeCard = (row) => row && ({
  ...row,
  total_spent: Number(row.total_spent),
  reminders_off: Boolean(row.reminders_off),
  has_app: row.customer_id !== null,
});

/* ═══════════════════ الربط ═══════════════════ */

/**
 * يرجّع رقم كارت الزبون في المحل (ويعمله لو مش موجود)، أو null.
 * لازم جوّه معاملة: القفل بيمنع كارتين لنفس الشخص لو طلبين جم مع بعض.
 */
export async function linkCard(tx, { shopId, customerId = null, phone = null, name }) {
  if (!customerId && !phone) return null;
  const cleanName = String(name || '').trim().slice(0, 60) || 'زبون';

  if (customerId) {
    const own = await tx.queryOne('SELECT id FROM shop_customers WHERE shop_id = ? AND customer_id = ? FOR UPDATE', [shopId, customerId]);
    if (own) return own.id;
    // كارت جديد للحساب من غير رقم: الرقم مش متأكّد منه، وكارت الموبايل القديم
    // (لو فيه) بيترَبط بكود من الاستقبال بس
    const account = await tx.queryOne('SELECT name FROM customers WHERE id = ?', [customerId]);
    return insertCard(tx, { shopId, customerId, phone: null, name: account?.name ?? cleanName });
  }

  const existing = await tx.queryOne('SELECT id FROM shop_customers WHERE shop_id = ? AND phone = ? FOR UPDATE', [shopId, phone]);
  if (existing) return existing.id;
  return insertCard(tx, { shopId, customerId: null, phone, name: cleanName });
}

async function insertCard(tx, { shopId, customerId, phone, name }) {
  try {
    const result = await tx.execute(
      'INSERT INTO shop_customers (shop_id, customer_id, phone, name) VALUES (?, ?, ?, ?)',
      [shopId, customerId, phone, name],
    );
    return result.insertId;
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    // طلب تاني عمله في نفس اللحظة
    const row = await tx.queryOne(
      'SELECT id FROM shop_customers WHERE shop_id = ? AND (customer_id = ? OR phone = ?) LIMIT 1',
      [shopId, customerId, phone],
    );
    if (!row) throw error;
    return row.id;
  }
}

/** زيارة خلصت (الدور اتقفل done): عدد الزيارات وآخر زيارة وآخر حلاق */
export async function recordVisit(tx, cardId, barberId) {
  if (!cardId) return;
  await tx.execute(
    `UPDATE shop_customers SET visits = visits + 1, last_visit_at = NOW(),
            first_visit_at = COALESCE(first_visit_at, NOW()), last_barber_id = COALESCE(?, last_barber_id)
      WHERE id = ?`,
    [barberId ?? null, cardId],
  );
}

/* ═══════════════════ ربط كارت الموبايل بحساب التطبيق ═══════════════════ */

const LINK_CODE_MINUTES = 15;
const LINK_CODE_ATTEMPTS = 5;
const linkCodeHash = (id, code) => sha256(`card-link:${id}:${code}`);

/**
 * يدمج كارت الموبايل (source) في كارت الحساب (target): الأدوار والفواتير
 * والصور والأختام والزيارات والملاحظات، وبعدين يمسح كارت الموبايل والرقم
 * يروح لكارت الحساب. لازم جوّه معاملة والكارتين مقفولين.
 */
async function mergeCards(tx, source, target) {
  for (const table of ['queue_tickets', 'bills', 'customer_photos', 'loyalty_events']) {
    await tx.execute(`UPDATE ${table} SET shop_customer_id = ? WHERE shop_customer_id = ?`, [target.id, source.id]);
  }
  const notes = [source.notes, target.notes].filter(Boolean).join('\n').slice(0, 1000) || null;
  const lastBarber = source.last_visit_at && (!target.last_visit_at || source.last_visit_at > target.last_visit_at)
    ? source.last_barber_id : target.last_barber_id;
  await tx.execute('DELETE FROM shop_customers WHERE id = ?', [source.id]);
  await tx.execute(
    `UPDATE shop_customers SET phone = ?, notes = ?,
            stamps = stamps + ?, rewards_redeemed = rewards_redeemed + ?, visits = visits + ?, total_spent = total_spent + ?,
            first_visit_at = CASE WHEN first_visit_at IS NULL OR (? IS NOT NULL AND ? < first_visit_at) THEN ? ELSE first_visit_at END,
            last_visit_at = CASE WHEN last_visit_at IS NULL OR (? IS NOT NULL AND ? > last_visit_at) THEN ? ELSE last_visit_at END,
            last_barber_id = ?, reminders_off = reminders_off OR ?
      WHERE id = ?`,
    [
      source.phone, notes, source.stamps, source.rewards_redeemed, source.visits, source.total_spent,
      source.first_visit_at, source.first_visit_at, source.first_visit_at,
      source.last_visit_at, source.last_visit_at, source.last_visit_at,
      lastBarber, source.reminders_off, target.id,
    ],
  );
  if (source.stamps > 0) {
    const { stamps } = await tx.queryOne('SELECT stamps FROM shop_customers WHERE id = ?', [target.id]);
    await tx.execute(
      `INSERT INTO loyalty_events (shop_id, shop_customer_id, type, delta, stamps_after, note)
       VALUES (?, ?, 'merge', ?, ?, 'ربط كارت الموبايل بالتطبيق')`,
      [target.shop_id, target.id, source.stamps, stamps],
    );
  }
}

/**
 * الاستقبال بيطلّع كود ربط لكارت موبايل (زبون الشارع) وهو شايف صاحبه
 * قدّامه. الكود 6 أرقام، صالح ربع ساعة ومرّة واحدة، وأي كود قديم بيتلغي.
 */
export async function issueLinkCode(shopId, cardId, userId) {
  const card = await queryOne('SELECT id, name, phone, customer_id FROM shop_customers WHERE id = ? AND shop_id = ?', [cardId, shopId]);
  if (!card) throw ApiError.notFound('الكارت غير موجود', { code: 'CARD_NOT_FOUND' });
  if (card.customer_id) throw ApiError.conflict('الكارت ده مربوط بحساب تطبيق بالفعل', { code: 'CARD_ALREADY_LINKED' });
  if (!card.phone) throw ApiError.conflict('الكارت ده مالوش رقم موبايل — اكتب الرقم الأول', { code: 'CARD_NO_PHONE' });
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await transaction(async (tx) => {
    await tx.execute('UPDATE card_link_codes SET used_at = NOW() WHERE shop_customer_id = ? AND used_at IS NULL', [cardId]);
    const inserted = await tx.execute(
      `INSERT INTO card_link_codes (shop_id, shop_customer_id, expires_at, issued_by)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
      [shopId, cardId, LINK_CODE_MINUTES, userId],
    );
    await tx.execute('UPDATE card_link_codes SET code_hash = ? WHERE id = ?', [linkCodeHash(inserted.insertId, code), inserted.insertId]);
  });
  return { code, expires_in_minutes: LINK_CODE_MINUTES, card: { id: card.id, name: card.name, phone: card.phone } };
}

/* ═══════════════════ كارت الأختام ═══════════════════ */

async function rewardServiceName(settings, shopId) {
  if (settings.loyalty_reward_type !== 'service' || !settings.loyalty_reward_service_id) return null;
  const row = await queryOne('SELECT name FROM services WHERE id = ? AND shop_id = ?', [settings.loyalty_reward_service_id, shopId]);
  return row?.name ?? null;
}

/** وصف المكافأة بالكلام: «قص ببلاش» · «أغلى خدمة ببلاش» · «خصم 50 ج» · «خصم 20%» */
export function rewardLabel(settings, serviceName = null) {
  switch (settings.loyalty_reward_type) {
    case 'service': return serviceName ? `«${serviceName}» ببلاش` : 'خدمة ببلاش';
    case 'amount': {
      const pounds = settings.loyalty_reward_value / 100;
      return `خصم ${Number.isInteger(pounds) ? pounds : pounds.toFixed(2)} ج`;
    }
    case 'percent': return `خصم ${settings.loyalty_reward_value}%`;
    default: return 'أغلى خدمة في الزيارة ببلاش';
  }
}

/** حالة كارت الأختام للعرض (اللوحة والكرسي وتطبيق الزبون) */
export function loyaltyStatus(settings, stamps, serviceName = null) {
  if (!settings.loyalty_enabled) return { enabled: false };
  const required = settings.loyalty_stamps_required;
  return {
    enabled: true,
    stamps,
    required,
    eligible: stamps >= required,
    left: Math.max(0, required - stamps),
    reward: rewardLabel(settings, serviceName),
  };
}

export async function loyaltyFor(shopId, stamps, settings = null) {
  const loaded = settings ?? await loadSettings(shopId);
  return loyaltyStatus(loaded, stamps, await rewardServiceName(loaded, shopId));
}

/** حركة أختام (جوّه معاملة، والكارت مقفول قبلها) */
export async function addStampEvent(tx, { shopId, cardId, billId = null, type, delta, note = null, userId = null }) {
  await tx.execute('UPDATE shop_customers SET stamps = GREATEST(0, CAST(stamps AS SIGNED) + ?) WHERE id = ?', [delta, cardId]);
  const { stamps } = await tx.queryOne('SELECT stamps FROM shop_customers WHERE id = ?', [cardId]);
  await tx.execute(
    `INSERT INTO loyalty_events (shop_id, shop_customer_id, bill_id, type, delta, stamps_after, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [shopId, cardId, billId, type, delta, stamps, note, userId],
  );
  return stamps;
}

/* ═══════════════════ ملخّص الكارت (للطابور والكرسي) ═══════════════════ */

/** ملخّص صغير لكل كارت: الملاحظات والأختام وآخر صورة */
export async function cardSummaries(shopId, cardIds) {
  const ids = [...new Set(cardIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const marks = ids.map(() => '?').join(',');
  const [rows, photos, settings] = await Promise.all([
    query(`SELECT id, name, notes, stamps, visits, last_visit_at, customer_id FROM shop_customers WHERE shop_id = ? AND id IN (${marks})`, [shopId, ...ids]),
    query(
      `SELECT p.shop_customer_id, MAX(p.id) AS last_photo_id FROM customer_photos p
        WHERE p.shop_id = ? AND p.deleted_at IS NULL AND p.shop_customer_id IN (${marks})
        GROUP BY p.shop_customer_id`,
      [shopId, ...ids],
    ),
    loadSettings(shopId),
  ]);
  const lastPhoto = new Map(photos.map((row) => [row.shop_customer_id, row.last_photo_id]));
  return new Map(rows.map((row) => [row.id, {
    id: row.id,
    notes: row.notes,
    visits: row.visits,
    last_visit_at: row.last_visit_at,
    has_app: row.customer_id !== null,
    last_photo_id: lastPhoto.get(row.id) ?? null,
    loyalty: loyaltyStatus(settings, row.stamps),
  }]));
}

/* ═══════════════════ الصور ═══════════════════ */

async function photoRow(shopId, photoId) {
  const row = await queryOne(
    'SELECT id, shop_customer_id, file_name, mime FROM customer_photos WHERE id = ? AND shop_id = ? AND deleted_at IS NULL',
    [photoId, shopId],
  );
  if (!row) throw ApiError.notFound('الصورة غير موجودة', { code: 'PHOTO_NOT_FOUND' });
  return row;
}

export async function addPhoto(shopId, cardId, buffer, { ticketId = null, barberId = null, takenBy, takenById = null }) {
  const card = await queryOne('SELECT id FROM shop_customers WHERE id = ? AND shop_id = ?', [cardId, shopId]);
  if (!card) throw ApiError.notFound('الكارت غير موجود', { code: 'CARD_NOT_FOUND' });
  const file = await savePhoto(shopId, buffer);
  const result = await query(
    `INSERT INTO customer_photos (shop_id, shop_customer_id, ticket_id, barber_id, file_name, mime, bytes, taken_by, taken_by_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [shopId, cardId, ticketId, barberId, file.file_name, file.mime, file.bytes, takenBy, takenById],
  );
  return { id: result.insertId, shop_customer_id: cardId, ticket_id: ticketId, mime: file.mime, bytes: file.bytes };
}

/** ملف صورة لكارت في المحل (الموظفين والكرسي) */
export async function photoFile(shopId, photoId, { cardId = null } = {}) {
  const row = await photoRow(shopId, photoId);
  if (cardId !== null && row.shop_customer_id !== cardId) throw ApiError.notFound('الصورة غير موجودة', { code: 'PHOTO_NOT_FOUND' });
  return { buffer: await readPhoto(shopId, row.file_name), mime: row.mime };
}

export async function deletePhoto(shopId, photoId, by) {
  const row = await photoRow(shopId, photoId);
  await query('UPDATE customer_photos SET deleted_at = NOW(), deleted_by = ? WHERE id = ?', [by, row.id]);
  await removePhoto(shopId, row.file_name);
  return { id: row.id, shop_customer_id: row.shop_customer_id };
}

/* ═══════════════════ العمليات ═══════════════════ */

async function findCard(shopId, id) {
  const row = await queryOne(`SELECT ${CARD_COLUMNS} FROM shop_customers WHERE id = ? AND shop_id = ?`, [id, shopId]);
  if (!row) throw ApiError.notFound('الكارت غير موجود', { code: 'CARD_NOT_FOUND' });
  return shapeCard(row);
}

export const cardsService = {
  async list(shopId, { q, page = 1, pageSize = 25 } = {}) {
    const params = [shopId];
    let where = 'sc.shop_id = ?';
    if (q) {
      const digits = q.replace(/\D/g, '');
      where += digits.length >= 3 ? ' AND (sc.name LIKE ? OR sc.phone LIKE ?)' : ' AND sc.name LIKE ?';
      params.push(`%${q}%`);
      if (digits.length >= 3) params.push(`%${digits}%`);
    }
    const { total } = await queryOne(`SELECT COUNT(*) AS total FROM shop_customers sc WHERE ${where}`, params);
    const offset = (page - 1) * pageSize;
    const rows = await query(
      `SELECT sc.id, sc.name, sc.phone, sc.customer_id, sc.stamps, sc.visits, sc.total_spent, sc.last_visit_at,
              sc.notes, b.name AS last_barber_name, c.phone AS app_phone
         FROM shop_customers sc LEFT JOIN barbers b ON b.id = sc.last_barber_id
         LEFT JOIN customers c ON c.id = sc.customer_id
        WHERE ${where}
        ORDER BY sc.last_visit_at IS NULL, sc.last_visit_at DESC, sc.id DESC
        LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}`,
      params,
    );
    return {
      rows: rows.map((row) => ({ ...row, total_spent: Number(row.total_spent), has_app: row.customer_id !== null })),
      meta: pageMeta(page, pageSize, Number(total)),
    };
  },

  async get(shopId, id) {
    const card = await findCard(shopId, id);
    const [visits, photos, events, barber] = await Promise.all([
      query(
        `SELECT t.id AS ticket_id, t.business_date, t.number, t.finished_at, t.total, b.name AS barber_name,
                (SELECT GROUP_CONCAT(ts.name ORDER BY ts.id SEPARATOR '، ') FROM ticket_services ts WHERE ts.ticket_id = t.id) AS services,
                bl.id AS bill_id, bl.total AS bill_total, bl.status AS bill_status
           FROM queue_tickets t
           LEFT JOIN barbers b ON b.id = t.barber_id
           LEFT JOIN bills bl ON bl.ticket_id = t.id
          WHERE t.shop_customer_id = ? AND t.shop_id = ? AND t.status = 'done'
          ORDER BY t.finished_at DESC, t.id DESC LIMIT 20`,
        [id, shopId],
      ),
      query(
        `SELECT p.id, p.ticket_id, p.created_at, b.name AS barber_name FROM customer_photos p
           LEFT JOIN barbers b ON b.id = p.barber_id
          WHERE p.shop_customer_id = ? AND p.shop_id = ? AND p.deleted_at IS NULL ORDER BY p.id DESC LIMIT 30`,
        [id, shopId],
      ),
      query(
        `SELECT type, delta, stamps_after, note, bill_id, created_at FROM loyalty_events
          WHERE shop_customer_id = ? ORDER BY id DESC LIMIT 15`,
        [id],
      ),
      card.last_barber_id ? queryOne('SELECT id, name FROM barbers WHERE id = ?', [card.last_barber_id]) : null,
    ]);
    const account = card.customer_id ? await queryOne('SELECT phone FROM customers WHERE id = ?', [card.customer_id]) : null;
    return {
      ...card,
      // رقم حساب التطبيق (مش متأكّد منه) للعرض بس — مش للبحث ولا للربط
      app_phone: account?.phone ?? null,
      last_barber: barber,
      loyalty: await loyaltyFor(shopId, card.stamps),
      visits_list: visits.map((row) => ({
        ...row, total: Number(row.total), bill_total: row.bill_total === null ? null : Number(row.bill_total),
      })),
      photos,
      loyalty_events: events,
    };
  },

  async update(shopId, id, changes) {
    const before = await findCard(shopId, id);
    const sets = [];
    const params = [];
    for (const column of ['name', 'notes', 'reminders_off']) {
      if (changes[column] !== undefined) { sets.push(`${column} = ?`); params.push(changes[column]); }
    }
    if (sets.length > 0) await query(`UPDATE shop_customers SET ${sets.join(', ')} WHERE id = ? AND shop_id = ?`, [...params, id, shopId]);
    return { before, after: await findCard(shopId, id) };
  },

  /** تعديل الأختام يدوي (المدير)، بسبب */
  async adjustStamps(shopId, id, delta, note, userId) {
    await findCard(shopId, id);
    const stamps = await transaction(async (tx) => {
      await tx.queryOne('SELECT id FROM shop_customers WHERE id = ? FOR UPDATE', [id]);
      return addStampEvent(tx, { shopId, cardId: id, type: 'adjust', delta, note, userId });
    });
    return { stamps, loyalty: await loyaltyFor(shopId, stamps) };
  },

  /* ── التذكير «بقالك 3 أسابيع» ── */

  /**
   * الزباين اللي عدّى على آخر زيارة ليهم عدد أيام الإعداد، وما اتفكّروش من
   * آخر زيارة، والتذكير مش مقفول عندهم، ومعندهمش دور شغّال.
   */
  async dueReminders(shopId, { limit = 100 } = {}) {
    const settings = await loadSettings(shopId);
    if (!settings.reminder_enabled) return { enabled: false, days: settings.reminder_days, rows: [] };
    const rows = await query(
      `SELECT sc.id, sc.name, sc.phone, sc.customer_id, sc.last_visit_at, sc.visits, b.name AS last_barber_name,
              DATEDIFF(NOW(), sc.last_visit_at) AS days_since,
              EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.customer_id = sc.customer_id) AS has_push
         FROM shop_customers sc LEFT JOIN barbers b ON b.id = sc.last_barber_id
        WHERE sc.shop_id = ? AND sc.reminders_off = 0 AND sc.last_visit_at IS NOT NULL
          AND sc.last_visit_at < DATE_SUB(NOW(), INTERVAL ? DAY)
          AND (sc.reminded_at IS NULL OR sc.reminded_at < sc.last_visit_at)
          AND NOT EXISTS (SELECT 1 FROM queue_tickets t WHERE t.shop_customer_id = sc.id AND t.status IN ('waiting','serving'))
        ORDER BY sc.last_visit_at
        LIMIT ${Math.min(Math.max(Number(limit) || 100, 1), 500)}`,
      [shopId, settings.reminder_days],
    );
    const shop = await queryOne('SELECT slug FROM shops WHERE id = ?', [shopId]);
    return {
      enabled: true,
      days: settings.reminder_days,
      shop_url: `${env.customerAppUrl}/s/${shop.slug}`,
      rows: rows.map((row) => ({ ...row, has_app: row.customer_id !== null, has_push: Boolean(row.has_push) })),
    };
  },

  async markReminded(shopId, id) {
    await findCard(shopId, id);
    await query('UPDATE shop_customers SET reminded_at = NOW() WHERE id = ? AND shop_id = ?', [id, shopId]);
    return { reminded: true };
  },
};

/* ── الزبون نفسه (تطبيق الزبون) ── */

export const customerCards = {
  /** كروت الزبون في كل المحلات اللي زارها: الأختام والمكافأة */
  async list(customerId) {
    const rows = await query(
      `SELECT sc.id, sc.shop_id, sc.stamps, sc.visits, sc.last_visit_at, sc.reminders_off, s.name AS shop_name, s.slug AS shop_slug
         FROM shop_customers sc JOIN shops s ON s.id = sc.shop_id
        WHERE sc.customer_id = ? ORDER BY sc.last_visit_at IS NULL, sc.last_visit_at DESC`,
      [customerId],
    );
    return Promise.all(rows.map(async (row) => ({
      ...row,
      reminders_off: Boolean(row.reminders_off),
      loyalty: await loyaltyFor(row.shop_id, row.stamps),
    })));
  },

  async setReminders(customerId, shopId, off) {
    const result = await query('UPDATE shop_customers SET reminders_off = ? WHERE customer_id = ? AND shop_id = ?', [off, customerId, shopId]);
    if (result.affectedRows === 0) throw ApiError.notFound('مالكش كارت في المحل ده', { code: 'CARD_NOT_FOUND' });
    return { reminders_off: off };
  },

  /**
   * الزبون كتب كود الربط اللي الاستقبال اداهوله: كارت الموبايل اللي رقمه
   * نفس رقم الحساب بيتدمج في كارت الحساب في المحل ده (أو بيترَبط بيه لو
   * الحساب مالوش كارت هناك لسه).
   */
  async linkWithCode(customerId, code) {
    const invalid = () => ApiError.badRequest('الكود غلط أو انتهى — اطلب كود جديد من المحل', { code: 'LINK_INVALID' });
    const account = await queryOne("SELECT id, phone FROM customers WHERE id = ? AND status = 'active'", [customerId]);
    if (!account?.phone) throw invalid();
    const record = await queryOne(
      `SELECT l.id, l.shop_id, l.shop_customer_id, l.code_hash FROM card_link_codes l
         JOIN shop_customers sc ON sc.id = l.shop_customer_id
        WHERE sc.phone = ? AND sc.customer_id IS NULL AND l.used_at IS NULL AND l.expires_at > NOW()
        ORDER BY l.id DESC LIMIT 1`,
      [account.phone],
    );
    if (!record?.code_hash) throw invalid();
    const expected = Buffer.from(record.code_hash, 'hex');
    const actual = Buffer.from(linkCodeHash(record.id, String(code)), 'hex');
    if (!crypto.timingSafeEqual(expected, actual)) {
      // بعد آخر محاولة الكود بيتحرق، والزبون يطلب كود جديد
      await execute(
        'UPDATE card_link_codes SET attempts = attempts + 1, used_at = IF(attempts + 1 >= ?, NOW(), used_at) WHERE id = ?',
        [LINK_CODE_ATTEMPTS, record.id],
      );
      throw invalid();
    }

    const cardId = await transaction(async (tx) => {
      const used = await tx.execute(
        'UPDATE card_link_codes SET used_at = NOW(), linked_customer_id = ? WHERE id = ? AND used_at IS NULL',
        [customerId, record.id],
      );
      if (used.affectedRows === 0) throw invalid();
      // الكارتين بالترتيب عشان ما يحصلش deadlock مع طلب تاني
      const rows = await tx.query(
        `SELECT ${CARD_COLUMNS} FROM shop_customers
          WHERE shop_id = ? AND (id = ? OR customer_id = ?) ORDER BY id FOR UPDATE`,
        [record.shop_id, record.shop_customer_id, customerId],
      );
      const source = rows.find((row) => row.id === record.shop_customer_id);
      const target = rows.find((row) => row.customer_id === customerId);
      if (!source || source.customer_id !== null) throw invalid();
      if (!target) {
        await tx.execute('UPDATE shop_customers SET customer_id = ? WHERE id = ?', [customerId, source.id]);
        return source.id;
      }
      await mergeCards(tx, source, target);
      return target.id;
    });

    const card = await queryOne(
      `SELECT sc.id, sc.shop_id, sc.stamps, sc.visits, sc.last_visit_at, sc.reminders_off, s.name AS shop_name, s.slug AS shop_slug
         FROM shop_customers sc JOIN shops s ON s.id = sc.shop_id WHERE sc.id = ?`,
      [cardId],
    );
    return { ...card, reminders_off: Boolean(card.reminders_off), loyalty: await loyaltyFor(card.shop_id, card.stamps) };
  },

  async photos(customerId) {
    return query(
      `SELECT p.id, p.created_at, s.name AS shop_name, b.name AS barber_name
         FROM customer_photos p
         JOIN shop_customers sc ON sc.id = p.shop_customer_id
         JOIN shops s ON s.id = p.shop_id
         LEFT JOIN barbers b ON b.id = p.barber_id
        WHERE sc.customer_id = ? AND p.deleted_at IS NULL
        ORDER BY p.id DESC LIMIT 60`,
      [customerId],
    );
  },

  async ownPhoto(customerId, photoId) {
    const row = await queryOne(
      `SELECT p.id, p.shop_id, p.file_name, p.mime FROM customer_photos p
         JOIN shop_customers sc ON sc.id = p.shop_customer_id
        WHERE p.id = ? AND sc.customer_id = ? AND p.deleted_at IS NULL`,
      [photoId, customerId],
    );
    if (!row) throw ApiError.notFound('الصورة غير موجودة', { code: 'PHOTO_NOT_FOUND' });
    return row;
  },

  async photoFile(customerId, photoId) {
    const row = await this.ownPhoto(customerId, photoId);
    return { buffer: await readPhoto(row.shop_id, row.file_name), mime: row.mime };
  },

  async deletePhoto(customerId, photoId) {
    const row = await this.ownPhoto(customerId, photoId);
    return deletePhoto(row.shop_id, row.id, 'customer');
  },
};
