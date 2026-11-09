/**
 * حسابات الكاشير في الواجهة (السيرفر بيعيد الحساب ويرفض أي فرق):
 * المطلوب، والمدفوع، والفاضل، والباقي للزبون، ومعاينة مكافأة الأختام.
 * كل المبالغ بالقروش.
 */

/** نفس توزيع السيرفر: المجموع مظبوط بالقرش */
export function allocate(amount, weights) {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (amount <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (Math.max(0, weight) * amount) / total);
  const shares = exact.map(Math.floor);
  let left = amount - shares.reduce((sum, share) => sum + share, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index] += 1;
    left -= 1;
  }
  return shares;
}

/**
 * قيمة مكافأة الأختام على الفاتورة (نفس قاعدة السيرفر).
 * @returns {number} قروش (0 = المكافأة مش على أي سطر)
 */
export function rewardPreview(settings, items, afterDiscount) {
  if (!settings?.loyalty_enabled) return 0;
  const services = items.filter((item) => item.kind === 'service');
  const top = (list) => list.reduce((best, item) => (!best || item.unit_price > best.unit_price ? item : best), null);
  switch (settings.loyalty_reward_type) {
    case 'service': {
      const line = top(services.filter((item) => item.service_id === settings.loyalty_reward_service_id));
      return line ? Math.min(line.unit_price, afterDiscount) : 0;
    }
    case 'top_service': {
      const line = top(services);
      return line ? Math.min(line.unit_price, afterDiscount) : 0;
    }
    case 'amount': return Math.min(settings.loyalty_reward_value, afterDiscount);
    case 'percent': return Math.min(Math.round((afterDiscount * settings.loyalty_reward_value) / 100), afterDiscount);
    default: return 0;
  }
}

/** أقصى خصم للاستقبال (نسبة من الفاتورة) */
export const cashierDiscountLimit = (subtotal, pct) => Math.round((subtotal * pct) / 100);

/**
 * حالة الدفع: المطلوب = الإجمالي + البقشيش، والمدفوع = مجموع السطور.
 * الكاش ممكن يتدفع بأكتر (tendered) والباقي يرجع للزبون.
 */
export function paymentState({ total, tip = 0, lines = [] }) {
  const due = total + tip;
  const paid = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const change = lines.reduce((sum, line) => {
    if (line.kind !== 'cash' || line.tendered === null || line.tendered === undefined) return sum;
    return sum + Math.max(0, line.tendered - (Number(line.amount) || 0));
  }, 0);
  const short = lines.some((line) => line.kind === 'cash' && line.tendered !== null && line.tendered !== undefined
    && line.tendered < (Number(line.amount) || 0));
  return {
    due,
    paid,
    remaining: due - paid,
    change,
    valid: paid === due && !short && lines.every((line) => (Number(line.amount) || 0) > 0 || due === 0),
    short,
  };
}

/** لما الكاشير يقسم الدفع: السطر الجديد بياخد الفاضل */
export function splitLine(lines, due, method) {
  const paid = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  return [...lines, { method: method.code, kind: method.kind, amount: Math.max(0, due - paid), tendered: null, reference: '' }];
}

/** فئات الفلوس المصرية لأزرار «اتدفع كام» السريعة */
const NOTES = [500, 1000, 2000, 5000, 10000, 20000, 50000];

/** اقتراحات «اتدفع كام» للكاش: المبلغ نفسه وأقرب ورقتين أكبر منه */
export function tenderSuggestions(amount) {
  if (!amount || amount <= 0) return [];
  const out = new Set([amount]);
  for (const note of NOTES) {
    const rounded = Math.ceil(amount / note) * note;
    if (rounded > amount) out.add(rounded);
    if (out.size >= 4) break;
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

export const METHOD_ICONS = { cash: 'dollar', card: 'card', wallet: 'phone', transfer: 'send', other: 'tag' };
