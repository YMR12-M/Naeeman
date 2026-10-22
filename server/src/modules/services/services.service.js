/**
 * قايمة الأسعار: الخدمات بأسعارها ومددها المبدئية.
 *
 * الخدمة ما بتتمسحش: الأرشفة بتخفيها من القايمة، والأدوار القديمة
 * شايلة نسختها من الاسم والسعر. وترتيب القايمة هو ترتيب ظهورها في
 * التطبيق والكشك.
 */
import { query, queryOne, transaction, placeholders } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';

const COLUMNS = 'id, name, price, default_minutes, active, sort_order, archived_at, created_at, updated_at';

const shape = (row) => ({ ...row, active: Boolean(row.active) });

async function find(shopId, id) {
  const row = await queryOne(`SELECT ${COLUMNS} FROM services WHERE id = ? AND shop_id = ?`, [id, shopId]);
  if (!row) throw ApiError.notFound('الخدمة غير موجودة', { code: 'SERVICE_NOT_FOUND' });
  return shape(row);
}

async function nextSortOrder(tx, shopId) {
  const row = await tx.queryOne('SELECT COALESCE(MAX(sort_order), 0) AS n FROM services WHERE shop_id = ?', [shopId]);
  return Number(row.n) + 10;
}

async function insert(tx, shopId, service) {
  const result = await tx.execute(
    'INSERT INTO services (shop_id, name, price, default_minutes, active, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    [shopId, service.name, service.price, service.default_minutes, service.active ?? true, await nextSortOrder(tx, shopId)],
  );
  return result.insertId;
}

export const servicesService = {
  async list(shopId, { includeArchived = false } = {}) {
    const rows = await query(
      `SELECT ${COLUMNS} FROM services WHERE shop_id = ? ${includeArchived ? '' : 'AND archived_at IS NULL'}
        ORDER BY archived_at IS NOT NULL, sort_order, id`,
      [shopId],
    );
    return rows.map(shape);
  },

  get: find,

  async create(shopId, payload) {
    const id = await transaction((tx) => insert(tx, shopId, payload));
    return find(shopId, id);
  },

  /** التجهيز لأوّل مرّة: الواجهة بتقترح قايمة والمالك بيعدّلها ويبعتها مرّة واحدة */
  async createMany(shopId, items) {
    const ids = await transaction(async (tx) => {
      const out = [];
      for (const item of items) out.push(await insert(tx, shopId, item));
      return out;
    });
    return query(
      `SELECT ${COLUMNS} FROM services WHERE id IN (${placeholders(ids.length)}) ORDER BY sort_order`,
      ids,
    ).then((rows) => rows.map(shape));
  },

  async update(shopId, id, changes) {
    const before = await find(shopId, id);
    if (before.archived_at) throw ApiError.conflict('الخدمة مؤرشفة — رجّعها الأول', { code: 'SERVICE_ARCHIVED' });
    const sets = [];
    const params = [];
    for (const column of ['name', 'price', 'default_minutes', 'active']) {
      if (changes[column] !== undefined) { sets.push(`${column} = ?`); params.push(changes[column]); }
    }
    if (sets.length > 0) {
      await query(`UPDATE services SET ${sets.join(', ')} WHERE id = ? AND shop_id = ?`, [...params, id, shopId]);
    }
    return { before, after: await find(shopId, id) };
  },

  /** ترتيب جديد للقايمة كلها: لازم كل الخدمات غير المؤرشفة تكون موجودة مرّة واحدة */
  async reorder(shopId, ids) {
    const current = await query('SELECT id FROM services WHERE shop_id = ? AND archived_at IS NULL', [shopId]);
    const expected = new Set(current.map((row) => row.id));
    if (ids.length !== expected.size || new Set(ids).size !== ids.length || ids.some((id) => !expected.has(id))) {
      throw ApiError.badRequest('الترتيب لازم يشمل كل الخدمات مرّة واحدة', { code: 'BAD_ORDER' });
    }
    await transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.execute('UPDATE services SET sort_order = ? WHERE id = ? AND shop_id = ?', [(index + 1) * 10, id, shopId]);
      }
    });
    return this.list(shopId);
  },

  async archive(shopId, id) {
    const before = await find(shopId, id);
    await query('UPDATE services SET archived_at = COALESCE(archived_at, NOW()), active = 0 WHERE id = ? AND shop_id = ?', [id, shopId]);
    return before;
  },

  async restore(shopId, id) {
    await find(shopId, id);
    await transaction(async (tx) => {
      await tx.execute(
        'UPDATE services SET archived_at = NULL, active = 1, sort_order = ? WHERE id = ? AND shop_id = ?',
        [await nextSortOrder(tx, shopId), id, shopId],
      );
    });
    return find(shopId, id);
  },
};
