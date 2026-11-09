/**
 * ═══════════════════════════════════════════════════════════════
 *  الدرج (الوردية)
 *
 *  الاستقبال يفتح الدرج بالفكّة، وكل دفعة كاش وكل حركة (مصروف، سلفة،
 *  صرف حساب حلاق، إيداع، سحب للخزنة) بتتسجّل عليه. قفل الدرج = عدّ
 *  الكاش: السيستم يحسب المفروض يكون كام ويسجّل الفرق.
 *
 *    المتوقّع = الفكّة + دفعات الكاش (والمرتجع بالسالب) + الإيداع
 *               − المصروف − السُلف − صرف الحسابات − السحب للخزنة
 *
 *  درج واحد مفتوح في المحل في نفس الوقت (قيد فريد على open_guard).
 *  القفل بياخد الدرج FOR UPDATE، والدفع بياخده مشترك، فدفعة ما تقعش
 *  في درج اتقفل حسابه.
 * ═══════════════════════════════════════════════════════════════
 */
import { query, queryOne, transaction, isDuplicate } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { openDrawerFor, todayFor } from './billing.service.js';

const OUTFLOWS = ['expense', 'advance', 'payout', 'cash_out'];

export const MOVEMENT_LABELS = {
  expense: 'مصروف', advance: 'سلفة', payout: 'صرف حساب', cash_in: 'إيداع', cash_out: 'سحب للخزنة',
};

/** أرقام الدرج: الكاش المتوقّع وتفصيله، والمحصّل بباقي الطرق */
export async function drawerTotals(tx, session) {
  const [byMethod, moves] = await Promise.all([
    tx.query(
      `SELECT method_code, method_label, method_kind,
              SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS received,
              SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS refunded,
              COUNT(*) AS count
         FROM payments WHERE drawer_session_id = ? GROUP BY method_code, method_label, method_kind ORDER BY method_kind <> 'cash', method_code`,
      [session.id],
    ),
    tx.query('SELECT type, SUM(amount) AS amount, COUNT(*) AS count FROM cash_movements WHERE drawer_session_id = ? GROUP BY type', [session.id]),
  ]);
  const movement = Object.fromEntries(Object.keys(MOVEMENT_LABELS).map((type) => [type, 0]));
  for (const row of moves) movement[row.type] = Number(row.amount);
  const cash = byMethod.filter((row) => row.method_kind === 'cash')
    .reduce((sum, row) => sum + Number(row.received) - Number(row.refunded), 0);
  const expected = Number(session.opening_float) + cash + movement.cash_in
    - OUTFLOWS.reduce((sum, type) => sum + movement[type], 0);
  return {
    methods: byMethod.map((row) => ({
      code: row.method_code, label: row.method_label, kind: row.method_kind,
      received: Number(row.received), refunded: Number(row.refunded), net: Number(row.received) - Number(row.refunded),
      count: Number(row.count),
    })),
    cash_payments: cash,
    movements: movement,
    expected_cash: expected,
  };
}

const SESSION_COLUMNS = `s.id, s.business_date, s.status, s.opening_float, s.opened_at, s.expected_cash, s.counted_cash,
  s.variance, s.closed_at, s.note, s.day_close_id, ou.full_name AS opened_by_name, cu.full_name AS closed_by_name`;

const shapeSession = (row) => row && ({
  ...row,
  opening_float: Number(row.opening_float),
  expected_cash: row.expected_cash === null ? null : Number(row.expected_cash),
  counted_cash: row.counted_cash === null ? null : Number(row.counted_cash),
  variance: row.variance === null ? null : Number(row.variance),
});

async function sessionView(id) {
  const row = shapeSession(await queryOne(
    `SELECT ${SESSION_COLUMNS} FROM drawer_sessions s
       LEFT JOIN users ou ON ou.id = s.opened_by LEFT JOIN users cu ON cu.id = s.closed_by WHERE s.id = ?`,
    [id],
  ));
  const moves = await query(
    `SELECT m.id, m.type, m.amount, m.note, m.barber_id, b.name AS barber_name, m.settlement_id, m.created_at, u.full_name AS created_by_name
       FROM cash_movements m LEFT JOIN barbers b ON b.id = m.barber_id LEFT JOIN users u ON u.id = m.created_by
      WHERE m.drawer_session_id = ? ORDER BY m.id DESC`,
    [id],
  );
  return {
    ...row,
    totals: await drawerTotals({ query }, row),
    movements: moves.map((move) => ({ ...move, amount: Number(move.amount) })),
  };
}

/**
 * حركة على الدرج المفتوح (جوّه معاملة). الخارج ما ينفعش يكون أكتر من
 * الكاش اللي في الدرج.
 */
export async function addMovement(tx, shopId, { type, amount, barberId = null, note = null, settlementId = null, userId = null }) {
  const drawer = await openDrawerFor(tx, shopId);
  if (!drawer) throw ApiError.conflict('افتح الدرج الأول', { code: 'DRAWER_CLOSED' });
  if (OUTFLOWS.includes(type)) {
    const { expected_cash: available } = await drawerTotals(tx, drawer);
    if (amount > available) {
      throw ApiError.conflict(`الدرج فيه ${available / 100} ج بس`, { code: 'DRAWER_SHORT', details: { available } });
    }
  }
  const result = await tx.execute(
    `INSERT INTO cash_movements (shop_id, drawer_session_id, business_date, type, amount, barber_id, note, settlement_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [shopId, drawer.id, await todayFor(shopId, tx), type, amount, barberId, note, settlementId, userId],
  );
  return { id: result.insertId, drawer_session_id: drawer.id };
}

export const drawerService = {
  async current(shopId) {
    const row = await queryOne("SELECT id FROM drawer_sessions WHERE shop_id = ? AND status = 'open'", [shopId]);
    return row ? sessionView(row.id) : null;
  },

  get: async (shopId, id) => {
    const row = await queryOne('SELECT id FROM drawer_sessions WHERE id = ? AND shop_id = ?', [id, shopId]);
    if (!row) throw ApiError.notFound('الوردية غير موجودة', { code: 'DRAWER_NOT_FOUND' });
    return sessionView(id);
  },

  async open(shopId, openingFloat, userId) {
    try {
      const result = await query(
        'INSERT INTO drawer_sessions (shop_id, business_date, opening_float, opened_by) VALUES (?, ?, ?, ?)',
        [shopId, await todayFor(shopId), openingFloat, userId],
      );
      return sessionView(result.insertId);
    } catch (error) {
      if (isDuplicate(error, 'uq_drawer_open')) throw ApiError.conflict('الدرج مفتوح بالفعل', { code: 'DRAWER_OPEN' });
      throw error;
    }
  },

  async movement(shopId, input, user, { canAdvance }) {
    if (input.type === 'advance' && !canAdvance) throw ApiError.forbidden('السُلف للمدير بس', { code: 'FORBIDDEN' });
    if (['advance', 'payout'].includes(input.type) && !input.barber_id) {
      throw ApiError.unprocessable('اختار الحلاق', { code: 'VALIDATION_ERROR', details: { barber_id: 'الحقل مطلوب' } });
    }
    if (input.barber_id) {
      const barber = await queryOne('SELECT id FROM barbers WHERE id = ? AND shop_id = ?', [input.barber_id, shopId]);
      if (!barber) throw ApiError.unprocessable('الحلاق غير موجود', { code: 'BAD_BARBER', details: { barber_id: 'غير موجود' } });
    }
    const { drawer_session_id: sessionId, id } = await transaction((tx) => addMovement(tx, shopId, {
      type: input.type, amount: input.amount, barberId: input.barber_id ?? null, note: input.note ?? null, userId: user.id,
    }));
    return { id, session: await sessionView(sessionId) };
  },

  /** قفل الدرج بعدّ الكاش */
  async close(shopId, counted, note, userId) {
    const id = await transaction(async (tx) => {
      const session = await tx.queryOne(
        "SELECT id, opening_float FROM drawer_sessions WHERE shop_id = ? AND status = 'open' FOR UPDATE",
        [shopId],
      );
      if (!session) throw ApiError.conflict('مفيش درج مفتوح', { code: 'DRAWER_CLOSED' });
      const { expected_cash: expected } = await drawerTotals(tx, session);
      await tx.execute(
        `UPDATE drawer_sessions SET status = 'closed', expected_cash = ?, counted_cash = ?, variance = ?,
                closed_by = ?, closed_at = NOW(), note = ? WHERE id = ?`,
        [expected, counted, counted - expected, userId, note ?? null, session.id],
      );
      return session.id;
    });
    return sessionView(id);
  },

  async sessions(shopId, { limit = 30 } = {}) {
    const rows = await query(
      `SELECT ${SESSION_COLUMNS} FROM drawer_sessions s
         LEFT JOIN users ou ON ou.id = s.opened_by LEFT JOIN users cu ON cu.id = s.closed_by
        WHERE s.shop_id = ? ORDER BY s.id DESC LIMIT ${Math.min(Math.max(Number(limit) || 30, 1), 200)}`,
      [shopId],
    );
    return rows.map(shapeSession);
  },
};
