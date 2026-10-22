/**
 * المحل نفسه: بياناته ومواعيده وقواعد الطابور، وحالته دلوقتي (فاتح ولا لأ).
 */
import { query, queryOne, execute, transaction } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { shopStatusAt } from '../../utils/hours.js';

const SHOP_COLUMNS = `id, uuid, name, slug, phone, whatsapp, address, city, latitude, longitude,
  timezone, currency, accepting_tickets, status, created_at, updated_at`;

const SETTINGS_COLUMNS = `remote_tickets_enabled, max_tickets_per_day, notify_ahead, grace_minutes,
  max_delays, close_buffer_minutes, display_name_style`;

const BOOL_SETTINGS = ['remote_tickets_enabled'];

const hm = (time) => String(time).slice(0, 5);

function shapeShop(row) {
  return { ...row, accepting_tickets: Boolean(row.accepting_tickets) };
}

function shapeSettings(row) {
  const out = { ...row };
  for (const key of BOOL_SETTINGS) out[key] = Boolean(out[key]);
  return out;
}

const shapePeriods = (rows) => rows.map((row) => ({
  weekday: row.weekday, opens_at: hm(row.opens_at), closes_at: hm(row.closes_at),
}));

export async function loadShop(shopId) {
  const shop = await queryOne(`SELECT ${SHOP_COLUMNS} FROM shops WHERE id = ?`, [shopId]);
  if (!shop) throw ApiError.notFound('المحل غير موجود', { code: 'SHOP_NOT_FOUND' });
  return shapeShop(shop);
}

export async function loadSettings(shopId, tx = { queryOne }) {
  const row = await tx.queryOne(`SELECT ${SETTINGS_COLUMNS} FROM shop_settings WHERE shop_id = ?`, [shopId]);
  // الصفّ بيتعمل مع المحل؛ لو مش موجود لأي سبب نرجع القيم الافتراضية من الجدول نفسه
  if (row) return shapeSettings(row);
  await execute('INSERT IGNORE INTO shop_settings (shop_id) VALUES (?)', [shopId]);
  return shapeSettings(await queryOne(`SELECT ${SETTINGS_COLUMNS} FROM shop_settings WHERE shop_id = ?`, [shopId]));
}

export async function loadHours(shopId, tx = { query }) {
  return shapePeriods(await tx.query(
    'SELECT weekday, opens_at, closes_at FROM shop_hours WHERE shop_id = ? ORDER BY weekday, opens_at',
    [shopId],
  ));
}

/** فاتح دلوقتي؟ + بيقفل امتى + بيفتح امتى (لو قافل) */
export function openState(shop, hours, now = new Date()) {
  const status = shopStatusAt(hours, shop.timezone, now);
  return {
    open: status.open,
    business_date: status.businessDate,
    closes_at: status.closesAt,
    next_opens_at: status.nextOpensAt,
  };
}

export const shopService = {
  async get(shopId) {
    const [shop, settings, hours] = await Promise.all([loadShop(shopId), loadSettings(shopId), loadHours(shopId)]);
    return { ...shop, settings, hours, now: openState(shop, hours) };
  },

  async update(shopId, changes) {
    const before = await loadShop(shopId);
    const columns = ['name', 'phone', 'whatsapp', 'address', 'city', 'latitude', 'longitude', 'accepting_tickets'];
    const sets = [];
    const params = [];
    for (const column of columns) {
      if (changes[column] !== undefined) { sets.push(`${column} = ?`); params.push(changes[column]); }
    }
    if (sets.length > 0) await execute(`UPDATE shops SET ${sets.join(', ')} WHERE id = ?`, [...params, shopId]);
    return { before, after: await loadShop(shopId) };
  },

  async getHours(shopId) {
    const [shop, hours] = await Promise.all([loadShop(shopId), loadHours(shopId)]);
    return { periods: hours, now: openState(shop, hours) };
  },

  /** الأسبوع كله بيتستبدل مرّة واحدة: أبسط للواجهة وما فيش فترات يتيمة */
  async replaceHours(shopId, periods) {
    const before = await loadHours(shopId);
    await transaction(async (tx) => {
      await tx.execute('DELETE FROM shop_hours WHERE shop_id = ?', [shopId]);
      for (const period of periods) {
        await tx.execute(
          'INSERT INTO shop_hours (shop_id, weekday, opens_at, closes_at) VALUES (?, ?, ?, ?)',
          [shopId, period.weekday, period.opens_at, period.closes_at],
        );
      }
    });
    return { before, after: await this.getHours(shopId) };
  },

  getSettings: (shopId) => loadSettings(shopId),

  async updateSettings(shopId, changes) {
    const before = await loadSettings(shopId);
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(changes)) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
    if (sets.length > 0) await execute(`UPDATE shop_settings SET ${sets.join(', ')} WHERE shop_id = ?`, [...params, shopId]);
    return { before, after: await loadSettings(shopId) };
  },
};
