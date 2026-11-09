/**
 * الحلاقين: الاسم ورقم الكرسي والحالة والـ PIN.
 *
 *  • الحالة: available (متاح) · break (استراحة لحد break_until) · off (مش موجود
 *    النهارده). الحلاق off مش داخل في حساب الوقت المتوقّع ولا بيظهر للزبون.
 *  • الـ PIN بيتخزّن bcrypt بس، وما بيرجعش للواجهة أبدًا (has_pin بدل منه).
 *  • رقم الكرسي ما يتكرّرش بين الحلاقين غير المؤرشفين.
 *  • الحلاق ما بيتمسحش: الأرشفة بتشيله من القايمة والأدوار القديمة شايلة رقمه.
 */
import { query, queryOne, execute, transaction } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { hashPassword } from '../../utils/security.js';
import { todayFor } from '../billing/billing.service.js';
import { markBarberDay } from '../payroll/payroll.service.js';

const COLUMNS = `id, name, chair_no, status, break_until, photo_path, sort_order, archived_at,
  (pin_hash IS NOT NULL) AS has_pin, created_at, updated_at`;

export const DEFAULT_BREAK_MINUTES = 15;

const shape = (row) => ({ ...row, has_pin: Boolean(row.has_pin) });

async function find(shopId, id) {
  const row = await queryOne(`SELECT ${COLUMNS} FROM barbers WHERE id = ? AND shop_id = ?`, [id, shopId]);
  if (!row) throw ApiError.notFound('الحلاق غير موجود', { code: 'BARBER_NOT_FOUND' });
  return shape(row);
}

async function assertChairFree(shopId, chairNo, exceptId = 0) {
  if (chairNo === null || chairNo === undefined) return;
  const taken = await queryOne(
    'SELECT name FROM barbers WHERE shop_id = ? AND chair_no = ? AND archived_at IS NULL AND id <> ?',
    [shopId, chairNo, exceptId],
  );
  if (taken) {
    throw ApiError.conflict(`الكرسي ${chairNo} عليه ${taken.name}`, {
      code: 'CHAIR_TAKEN', details: { chair_no: `عليه ${taken.name}` },
    });
  }
}

export const barbersService = {
  async list(shopId, { includeArchived = false } = {}) {
    const rows = await query(
      `SELECT ${COLUMNS} FROM barbers WHERE shop_id = ? ${includeArchived ? '' : 'AND archived_at IS NULL'}
        ORDER BY archived_at IS NOT NULL, sort_order, id`,
      [shopId],
    );
    return rows.map(shape);
  },

  get: find,

  async create(shopId, payload) {
    await assertChairFree(shopId, payload.chair_no);
    const pinHash = payload.pin ? await hashPassword(payload.pin) : null;
    const id = await transaction(async (tx) => {
      const { n } = await tx.queryOne('SELECT COALESCE(MAX(sort_order), 0) AS n FROM barbers WHERE shop_id = ?', [shopId]);
      const result = await tx.execute(
        'INSERT INTO barbers (shop_id, name, chair_no, pin_hash, sort_order) VALUES (?, ?, ?, ?, ?)',
        [shopId, payload.name, payload.chair_no ?? null, pinHash, Number(n) + 10],
      );
      return result.insertId;
    });
    return find(shopId, id);
  },

  async update(shopId, id, changes) {
    const before = await find(shopId, id);
    if (before.archived_at) throw ApiError.conflict('الحلاق مؤرشف — رجّعه الأول', { code: 'BARBER_ARCHIVED' });
    if (changes.chair_no !== undefined) await assertChairFree(shopId, changes.chair_no, id);
    const sets = [];
    const params = [];
    for (const column of ['name', 'chair_no']) {
      if (changes[column] !== undefined) { sets.push(`${column} = ?`); params.push(changes[column]); }
    }
    if (sets.length > 0) await execute(`UPDATE barbers SET ${sets.join(', ')} WHERE id = ? AND shop_id = ?`, [...params, id, shopId]);
    return { before, after: await find(shopId, id) };
  },

  /** PIN جديد بيفكّ القفل ويصفّر المحاولات */
  async setPin(shopId, id, pin) {
    await find(shopId, id);
    await execute(
      'UPDATE barbers SET pin_hash = ?, failed_pins = 0, pin_locked_until = NULL WHERE id = ? AND shop_id = ?',
      [await hashPassword(pin), id, shopId],
    );
    return find(shopId, id);
  },

  /** متاح / استراحة (لمدّة) / مش موجود */
  async setStatus(shopId, id, { status, break_minutes: breakMinutes }) {
    const before = await find(shopId, id);
    if (before.archived_at) throw ApiError.conflict('الحلاق مؤرشف', { code: 'BARBER_ARCHIVED' });
    if (status === 'break') {
      await execute(
        "UPDATE barbers SET status = 'break', break_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?",
        [breakMinutes ?? DEFAULT_BREAK_MINUTES, id],
      );
    } else {
      await execute('UPDATE barbers SET status = ?, break_until = NULL WHERE id = ?', [status, id]);
    }
    // «موجود» = يوم شغل في حساب الحلاق (اليومية)
    if (status === 'available') await markBarberDay({ execute }, { shopId, barberId: id, date: await todayFor(shopId) });
    return { before, after: await find(shopId, id) };
  },

  async reorder(shopId, ids) {
    const current = await query('SELECT id FROM barbers WHERE shop_id = ? AND archived_at IS NULL', [shopId]);
    const expected = new Set(current.map((row) => row.id));
    if (ids.length !== expected.size || new Set(ids).size !== ids.length || ids.some((id) => !expected.has(id))) {
      throw ApiError.badRequest('الترتيب لازم يشمل كل الحلاقين مرّة واحدة', { code: 'BAD_ORDER' });
    }
    await transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.execute('UPDATE barbers SET sort_order = ? WHERE id = ? AND shop_id = ?', [(index + 1) * 10, id, shopId]);
      }
    });
    return this.list(shopId);
  },

  async archive(shopId, id) {
    const before = await find(shopId, id);
    await execute(
      "UPDATE barbers SET archived_at = COALESCE(archived_at, NOW()), status = 'off', break_until = NULL, chair_no = NULL WHERE id = ?",
      [id],
    );
    return before;
  },

  async restore(shopId, id) {
    await find(shopId, id);
    await execute('UPDATE barbers SET archived_at = NULL WHERE id = ? AND shop_id = ?', [id, shopId]);
    return find(shopId, id);
  },
};
