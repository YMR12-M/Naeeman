/**
 * عدّاد متسلسل ذرّي لكل محل (رقم الدور اليومي).
 *
 * `INSERT … ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)` يزيد
 * العدّاد ويحفظ قيمته الجديدة في اتصالنا نحن، فلا يحصل طلبان على نفس
 * الرقم حتى لو تزامنا. لهذا يلزم تمرير معاملة `tx`: الجملتان لازم تعملان
 * على اتصال واحد.
 */
export async function nextCounter(tx, shopId, name) {
  await tx.execute(
    `INSERT INTO counters (shop_id, name, value) VALUES (?, ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)`,
    [shopId, name],
  );
  const row = await tx.queryOne('SELECT LAST_INSERT_ID() AS n');
  return Number(row.n);
}
