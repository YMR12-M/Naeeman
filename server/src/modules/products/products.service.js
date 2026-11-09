/**
 * ═══════════════════════════════════════════════════════════════
 *  المنتجات والمخزن
 *
 *  الكمية بتتغيّر من مكان واحد بس: `moveStock` (حركة + تحديث الكمية في
 *  نفس المعاملة)، فأي رقم في المخزن ليه أصل في `stock_movements`.
 *  الشراء بيحدّث متوسّط التكلفة المرجّح، والبيع والمرتجع بييجوا من
 *  الفاتورة، والجرد بيعدّل بفرق (بسبب)، والاستهلاك لحاجات المحل نفسه.
 * ═══════════════════════════════════════════════════════════════
 */
import { query, queryOne, transaction, isDuplicate } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { weightedCost } from '../../utils/money.js';

const COLUMNS = `id, name, barcode, price, cost, track_stock, stock_qty, low_stock_at, active,
  sort_order, archived_at, created_at, updated_at`;

export const shapeProduct = (row) => ({
  ...row,
  price: Number(row.price),
  cost: Number(row.cost),
  track_stock: Boolean(row.track_stock),
  active: Boolean(row.active),
  low_stock: Boolean(row.track_stock) && row.low_stock_at !== null && row.stock_qty <= row.low_stock_at,
});

async function find(shopId, id, tx = { queryOne }) {
  const row = await tx.queryOne(`SELECT ${COLUMNS} FROM products WHERE id = ? AND shop_id = ?`, [id, shopId]);
  if (!row) throw ApiError.notFound('المنتج غير موجود', { code: 'PRODUCT_NOT_FOUND' });
  return shapeProduct(row);
}

const duplicateBarcode = () => ApiError.conflict('الباركود ده متسجّل على منتج تاني', {
  code: 'BARCODE_TAKEN', details: { barcode: 'متسجّل على منتج تاني' },
});

/**
 * حركة مخزن واحدة (لازم جوّه معاملة). `qty` موجب = دخل، سالب = خرج.
 * المنتج اللي مش متتبّع مخزنه ما بتتسجّلش له حركة.
 * @returns {Promise<number|null>} الكمية بعد الحركة
 */
export async function moveStock(tx, { shopId, productId, type, qty, unitCost = null, billId = null, note = null, userId = null }) {
  const product = await tx.queryOne(
    'SELECT id, track_stock, stock_qty, cost FROM products WHERE id = ? AND shop_id = ? FOR UPDATE',
    [productId, shopId],
  );
  if (!product) throw ApiError.notFound('المنتج غير موجود', { code: 'PRODUCT_NOT_FOUND' });
  if (!product.track_stock) return null;

  const after = product.stock_qty + qty;
  const cost = type === 'purchase' && unitCost !== null
    ? weightedCost(product.stock_qty, Number(product.cost), qty, unitCost)
    : Number(product.cost);
  await tx.execute('UPDATE products SET stock_qty = ?, cost = ? WHERE id = ?', [after, cost, productId]);
  await tx.execute(
    `INSERT INTO stock_movements (shop_id, product_id, type, qty, unit_cost, stock_after, bill_id, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [shopId, productId, type, qty, unitCost, after, billId, note, userId],
  );
  return after;
}

export const productsService = {
  async list(shopId, { includeArchived = false, q } = {}) {
    const params = [shopId];
    let where = 'shop_id = ?';
    if (!includeArchived) where += ' AND archived_at IS NULL';
    if (q) {
      where += ' AND (name LIKE ? OR barcode = ?)';
      params.push(`%${q}%`, q);
    }
    const rows = await query(
      `SELECT ${COLUMNS} FROM products WHERE ${where} ORDER BY archived_at IS NOT NULL, sort_order, id`,
      params,
    );
    return rows.map(shapeProduct);
  },

  get: (shopId, id) => find(shopId, id),

  async lookup(shopId, barcode) {
    const row = await queryOne(
      `SELECT ${COLUMNS} FROM products WHERE shop_id = ? AND barcode = ? AND archived_at IS NULL`,
      [shopId, barcode],
    );
    if (!row) throw ApiError.notFound('مفيش منتج بالباركود ده', { code: 'BARCODE_NOT_FOUND' });
    return shapeProduct(row);
  },

  /** منتج جديد. الكمية الأوّلانية (لو فيه) بتتسجّل حركة شراء بتكلفتها. */
  async create(shopId, input, userId) {
    try {
      const id = await transaction(async (tx) => {
        const order = await tx.queryOne('SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM products WHERE shop_id = ?', [shopId]);
        const result = await tx.execute(
          `INSERT INTO products (shop_id, name, barcode, price, cost, track_stock, low_stock_at, active, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shopId, input.name, input.barcode ?? null, input.price, input.cost ?? 0, input.track_stock ?? true,
            input.low_stock_at ?? null, input.active ?? true, Number(order.n),
          ],
        );
        if (input.initial_qty && (input.track_stock ?? true)) {
          await moveStock(tx, {
            shopId, productId: result.insertId, type: 'purchase', qty: input.initial_qty,
            unitCost: input.cost ?? 0, note: 'رصيد أوّل', userId,
          });
        }
        return result.insertId;
      });
      return find(shopId, id);
    } catch (error) {
      if (isDuplicate(error, 'uq_products_barcode')) throw duplicateBarcode();
      throw error;
    }
  },

  async update(shopId, id, changes) {
    const before = await find(shopId, id);
    if (before.archived_at) throw ApiError.conflict('المنتج مؤرشف — رجّعه الأول', { code: 'PRODUCT_ARCHIVED' });
    const sets = [];
    const params = [];
    for (const column of ['name', 'barcode', 'price', 'cost', 'track_stock', 'low_stock_at', 'active']) {
      if (changes[column] !== undefined) { sets.push(`${column} = ?`); params.push(changes[column]); }
    }
    try {
      if (sets.length > 0) await query(`UPDATE products SET ${sets.join(', ')} WHERE id = ? AND shop_id = ?`, [...params, id, shopId]);
    } catch (error) {
      if (isDuplicate(error, 'uq_products_barcode')) throw duplicateBarcode();
      throw error;
    }
    return { before, after: await find(shopId, id) };
  },

  async archive(shopId, id) {
    const before = await find(shopId, id);
    await query('UPDATE products SET archived_at = COALESCE(archived_at, NOW()), active = 0 WHERE id = ? AND shop_id = ?', [id, shopId]);
    return before;
  },

  async restore(shopId, id) {
    await find(shopId, id);
    await query('UPDATE products SET archived_at = NULL, active = 1 WHERE id = ? AND shop_id = ?', [id, shopId]);
    return find(shopId, id);
  },

  /**
   * حركة يدوية: شراء (كمية + تكلفة الوحدة)، أو جرد (الكمية الجديدة اللي اتعدّت)،
   * أو استهلاك جوّه المحل (كمية).
   */
  async stock(shopId, id, input, userId) {
    const product = await find(shopId, id);
    if (!product.track_stock) throw ApiError.conflict('المنتج ده مش متتبّع مخزنه', { code: 'STOCK_NOT_TRACKED' });
    await transaction(async (tx) => {
      if (input.type === 'purchase') {
        await moveStock(tx, { shopId, productId: id, type: 'purchase', qty: input.qty, unitCost: input.unit_cost ?? product.cost, note: input.note, userId });
      } else if (input.type === 'use') {
        await moveStock(tx, { shopId, productId: id, type: 'use', qty: -input.qty, note: input.note, userId });
      } else {
        // جرد: الفرق بين اللي اتعدّ واللي في السيستم (تحت القفل)
        const row = await tx.queryOne('SELECT stock_qty FROM products WHERE id = ? FOR UPDATE', [id]);
        const delta = input.counted_qty - row.stock_qty;
        if (delta !== 0) await moveStock(tx, { shopId, productId: id, type: 'adjust', qty: delta, note: input.note, userId });
      }
    });
    return find(shopId, id);
  },

  async movements(shopId, id, { limit = 50 } = {}) {
    await find(shopId, id);
    const rows = await query(
      `SELECT m.id, m.type, m.qty, m.unit_cost, m.stock_after, m.bill_id, m.note, m.created_at,
              u.full_name AS created_by_name
         FROM stock_movements m LEFT JOIN users u ON u.id = m.created_by
        WHERE m.product_id = ? AND m.shop_id = ?
        ORDER BY m.id DESC LIMIT ${Math.min(Math.max(Number(limit) || 50, 1), 200)}`,
      [id, shopId],
    );
    return rows.map((row) => ({ ...row, unit_cost: row.unit_cost === null ? null : Number(row.unit_cost) }));
  },
};
