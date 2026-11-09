/**
 * حسابات الفلوس بالقروش (أعداد صحيحة دايمًا).
 *
 *  • النِسب مخزّنة × 100: 4000 = 40%، و1250 = 12.5%.
 *  • التوزيع (allocate) بيقسم مبلغ على أوزان بحيث المجموع يطلع مظبوط
 *    بالقرش: كل واحد ياخد نصيبه مقرّب لتحت، والقروش الفاضلة بتروح للي
 *    عندهم أكبر كسر. فخصم 10 ج على 3 سطور ما يطلعش 9.99 ولا 10.01.
 */

/** مبلغ × نسبة (× 100) مقرّب لأقرب قرش */
export const applyRate = (amount, rateBp) => Math.round((Number(amount) * Number(rateBp)) / 10_000);

/** نسبة مئوية عادية (0-100) */
export const percentOf = (amount, percent) => Math.round((Number(amount) * Number(percent)) / 100);

/**
 * يقسم `amount` على `weights` بالنسبة، والمجموع = amount بالظبط.
 * @param {number}   amount   قروش (≥ 0)
 * @param {number[]} weights  أوزان (≥ 0)
 * @returns {number[]}
 */
export function allocate(amount, weights) {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (amount <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (Math.max(0, weight) * amount) / total);
  const shares = exact.map(Math.floor);
  let left = amount - shares.reduce((sum, share) => sum + share, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index] += 1;
    left -= 1;
  }
  return shares;
}

/** متوسّط التكلفة المرجّح بعد شراء كمية بتكلفة جديدة */
export function weightedCost(currentQty, currentCost, addedQty, addedCost) {
  const before = Math.max(0, currentQty);
  if (before + addedQty <= 0) return addedCost;
  return Math.round((before * currentCost + addedQty * addedCost) / (before + addedQty));
}
