/**
 * تنسيق الأرقام والفلوس والأوقات.
 *
 * أرقام غربية (0-9) في كل مكان. الفلوس بتوصل بالقروش، وبتتعرض «120 ج»
 * (العملة بعد الرقم، زي قايمة الأسعار على الحيطة).
 */
const LOCALE = 'ar-EG-u-nu-latn';

const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export const formatNumber = (value) => (value === null || value === undefined ? '—' : numberFormat.format(value));

/**
 * قروش ← «120 ج» أو «120.50 ج».
 * معزول كاتجاه RTL (زي التواريخ تحت): الـ «ج» تفضل على شمال الرقم في القراية
 * العربية حتى لو المبلغ جوّه `.num` (اللي بيفرض LTR).
 */
export function formatMoney(minor, { sign = '' } = {}) {
  if (minor === null || minor === undefined) return '—';
  const pounds = minor / 100;
  const text = Number.isInteger(pounds) ? numberFormat.format(pounds) : pounds.toFixed(2);
  // العلامة (− أو +) جوّه العزل: برّاه كانت بتلزق في «ج» بدل الرقم
  return `\u2067${sign}${text} ج\u2069`;
}

/** ما كتبه المستخدم (جنيه) ← قروش صحيحة، أو null لو غلط */
export function inputToMinor(text) {
  if (text === '' || text === null || text === undefined) return null;
  const normalized = String(text).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.').trim();
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : null;
}
export const minorToInput = (minor) => (minor === null || minor === undefined ? '' : String(minor / 100));

/**
 * نصّ فيه كلمة عربية وأرقام («2:30 م») بيتعزل كاتجاه RTL مستقل عشان ما يتلخبطش
 * جوّه `.num` أو جنب كلام تاني.
 */
const rtl = (text) => `⁧${text}⁩`;

export const formatTime = (value) => (value ? rtl(timeFormat.format(new Date(value))) : '—');
export const formatDateTime = (value) => (value ? rtl(dateTimeFormat.format(new Date(value))) : '—');
/** '2026-10-22' ← «الخميس 22 أكتوبر» */
export const formatDate = (iso) => (iso ? rtl(dateFormat.format(new Date(`${iso}T00:00:00Z`))) : '—');

/** «دقيقة» · «دقيقتين» · «5 دقايق» · «25 دقيقة» (من 3 لـ 10 جمع، وبعدها مفرد زي الكلام) */
function minutesWord(value) {
  if (value === 1) return 'دقيقة';
  if (value === 2) return 'دقيقتين';
  return value >= 3 && value <= 10 ? `${value} دقايق` : `${value} دقيقة`;
}

/** دقايق ← «25 دقيقة» · «ساعة و10 د» */
export function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const value = Math.max(0, Math.round(minutes));
  if (value < 60) return minutesWord(value);
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  const hoursText = hours === 1 ? 'ساعة' : hours === 2 ? 'ساعتين' : `${hours} ساعات`;
  return rest ? `${hoursText} و${rest} د` : hoursText;
}

/** الدقايق من لحظة لحد دلوقتي */
export const minutesSince = (value, now = Date.now()) => (value ? Math.max(0, Math.floor((now - new Date(value).getTime()) / 60_000)) : 0);

/** «بعد 25 د» / «دلوقتي» من وقت متوقّع */
export function etaLabel(eta, now = Date.now()) {
  if (!eta) return '—';
  const minutes = Math.round((new Date(eta).getTime() - now) / 60_000);
  return minutes <= 1 ? 'دلوقتي' : `بعد ${minutes} د`;
}

export const initial = (name = '') => [...name.trim()][0] ?? '؟';

/** +201012345678 ← 0101 234 5678 */
export function formatPhone(phone) {
  if (!phone) return '—';
  const egypt = /^\+20(1[0125]\d{8})$/.exec(phone);
  if (egypt) {
    const local = `0${egypt[1]}`;
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  return phone;
}

/** رابط واتساب برسالة جاهزة (علامات العزل الاتجاهي بتتشال: الرسالة نصّ عادي) */
export const whatsappLink = (phone, text = '') => {
  const plain = text.replace(/[⁦-⁩]/g, '');
  return `https://wa.me/${String(phone ?? '').replace(/\D/g, '')}${plain ? `?text=${encodeURIComponent(plain)}` : ''}`;
};

export const WEEKDAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

export const STATUS_LABELS = {
  waiting: 'مستني', serving: 'على الكرسي', done: 'خلص', cancelled: 'اتلغى', no_show: 'ما جاش',
};
export const SOURCE_LABELS = { app: 'التطبيق', kiosk: 'الباب', staff: 'الاستقبال' };
export const BARBER_STATUS_LABELS = { available: 'متاح', break: 'استراحة', off: 'مش موجود' };
