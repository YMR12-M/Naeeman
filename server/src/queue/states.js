/**
 * ═══════════════════════════════════════════════════════════════
 *  حالات الدور — مصدر الحقيقة الوحيد للانتقالات
 *
 *    waiting ──(التالي)──▶ serving ──(التالي / خلّصت)──▶ done
 *       │
 *       ├──(الزبون أو الاستقبال)──▶ cancelled
 *       └──(انتهت المهلة مرّتين)──▶ no_show
 *
 *  جوّه waiting فيه علامات مش حالات: وصل (arrived_at)، اتنادى ومستني
 *  (called_at)، اتأخّر (delays_used / auto_delayed).
 * ═══════════════════════════════════════════════════════════════
 */
import { ApiError } from '../utils/ApiError.js';

export const STATES = ['waiting', 'serving', 'done', 'cancelled', 'no_show'];
export const ACTIVE_STATES = ['waiting', 'serving'];

/** من ← إلى ← مين يقدر */
const TRANSITIONS = {
  waiting: {
    serving: ['chair', 'staff'],
    // الكشك يلغي بس خلال دقيقة من أخد الدور (الزبون غلط في الاختيار) — بيتحقّق في الخدمة
    cancelled: ['customer', 'staff', 'kiosk', 'system'],
    no_show: ['staff', 'system'],
  },
  serving: {
    done: ['chair', 'staff', 'system'],
    cancelled: ['staff'],
  },
  done: {},
  cancelled: {},
  no_show: {},
};

const LABELS = {
  waiting: 'مستني', serving: 'على الكرسي', done: 'خلص', cancelled: 'اتلغى', no_show: 'ما جاش',
};

export const canTransition = (from, to, actor) => Boolean(TRANSITIONS[from]?.[to]?.includes(actor));

export function assertTransition(from, to, actor) {
  if (canTransition(from, to, actor)) return;
  throw ApiError.conflict(`الدور ${LABELS[from] ?? from} — مينفعش يبقى ${LABELS[to] ?? to}`, {
    code: 'BAD_TRANSITION',
    details: { from, to },
  });
}
