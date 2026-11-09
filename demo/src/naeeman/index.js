/* ============================================
   نعيمًا - الباك إند التجريبي (عرض فقط)

   لوحة المحل على «/» (ومعاها شاشة التلفزيون /display والكشك /kiosk وتابلت
   الكرسي /chair)، وتطبيق الزبون على «/app». الاتنين على نفس الدومين وبيقروا
   نفس البيانات، فدور بتاخده من التطبيق بيظهر في اللوحة والتلفزيون لايف.
   ============================================ */
import { createDemo } from '../core.js';
import { byId, todayOf } from './base.js';
import { handle } from './routes.js';
import { loadState, queue } from './queue.js';
import { periodSummary } from './money.js';
import { DEMO_PASSWORD, SHOP_SLUG, finishSeed, seed } from './seed.js';

const inCustomerApp = () => window.location.pathname === '/app' || window.location.pathname.indexOf('/app/') === 0;

/** يربط شاشة من أجهزة المحل المتسجّلة على المتصفّح ده (بدل كود الربط) */
function pairScreen(api, type, deviceId) {
  const db = api.db();
  const d = byId(db.devices, deviceId) || db.devices.find((x) => x.type === type && !x.revoked_at);
  if (!d) return;
  if (d.revoked_at) d.revoked_at = null;
  try {
    localStorage.setItem(`naeeman.device.${type}`, JSON.stringify({
      token: d.token, device: { id: d.id, type: d.type, name: d.name, shop: { name: db.shop.name, slug: db.shop.slug } },
    }));
  } catch (e) {
    /* التخزين مقفول */
  }
}

/** «حرّك الطابور»: الحلاق اللي هيفضى الأول يدوس «التالي» */
function stepQueue(api) {
  return api.mutate((db) => {
    const state = loadState(db);
    const waiting = state.waiting();
    const serving = state.tickets.filter((t) => t.status === 'serving');
    if (!waiting.length && !serving.length) return 'الطابور فاضي — خُد دور من التطبيق أو من الكشك';
    const present = state.barbers.filter((b) => b.status !== 'off');
    let barber = null;
    // حلاق فاضي وفيه حد مستنيه
    barber = present.find((b) => !serving.some((t) => t.barber_id === b.id)
      && waiting.some((t) => t.preferred_barber_id === null || t.preferred_barber_id === b.id));
    if (!barber && serving.length) {
      const first = serving.slice().sort((a, b) => a.started_at - b.started_at)[0];
      barber = present.find((b) => b.id === first.barber_id) || null;
    }
    if (!barber) return 'مفيش حلاق فاضي للي مستنيين دلوقتي';
    const result = queue.next(db, barber.id, { type: 'staff', id: 3 });
    const started = result.started_id ? byId(db.tickets, result.started_id) : null;
    if (started) return `${barber.name} داس «التالي» — رقم ${started.number} قعد على الكرسي`;
    if (result.called_ids.length) return `${barber.name} نادى رقم ${byId(db.tickets, result.called_ids[0]).number} (لسه ما وصلش)`;
    return `${barber.name} خلّص — مفيش حد مستنيه`;
  });
}

const staffLogin = (userId) => (api) => {
  api.db().cookies.staff = userId;
  api.go('/');
};
const customerLogin = (customerId, path) => (api) => {
  api.db().cookies.customer = customerId;
  api.go(path);
};
const openScreen = (type, deviceId, path) => (api) => {
  pairScreen(api, type, deviceId);
  api.open(path);
};

createDemo({
  key: 'naeeman_demo_db',
  version: 1,
  prefix: '/api/v1',
  seed(db) {
    seed(db);
    finishSeed(db, periodSummary);
  },
  // يوم جديد = محل جديد (الطابور القديم كان هيتقفل لوحده)
  stale: (db) => !db.shop || db.seedDay !== todayOf(db),
  handle,
  home: inCustomerApp() ? `/app/s/${SHOP_SLUG}` : '/',
  bar() {
    if (inCustomerApp()) {
      return {
        label: 'نسخة تجريبية',
        openFirst: true,
        intro: 'ده تطبيق الزبون في «نعيمًا» ببيانات محل وهمي متخزنة على جهازك بس. ادخل بزبون جاهز:',
        actions: [
          { label: 'ادخل كعمر (عنده دور شغّال)', primary: true, run: customerLogin(2, '/app/turn') },
          { label: 'ادخل كأحمد (كارت أختام وصور قصّات)', run: customerLogin(1, '/app/account') },
          { section: 'المحل' },
          { label: 'حرّك الطابور خطوة', run: stepQueue },
          { label: 'افتح لوحة المحل في تبويب جديد', run: (api) => api.open('/') },
        ],
        note: `أو سجّل دخول برقم 01005556677 (عمر) أو 01001112233 (أحمد) وكلمة السر ${DEMO_PASSWORD}، أو اعمل حساب جديد.`,
        css: '#demo-bar{bottom:calc(84px + env(safe-area-inset-bottom))}',
      };
    }
    const screen = /^\/(display|kiosk|chair)/.test(window.location.pathname);
    return {
      label: 'نسخة تجريبية',
      openFirst: !screen,
      intro: 'ده عرض لـ«نعيمًا» على محل حلاقة وهمي («صالون الأمل») متخزن على جهازك بس. ادخل بأي حد من الفريق:',
      actions: [
        { label: 'ادخل كحسن (صاحب المحل)', primary: true, run: staffLogin(1) },
        { label: 'ادخل ككريم (المدير)', run: staffLogin(2) },
        { label: 'ادخل كمنى (الاستقبال والكاشير)', run: staffLogin(3) },
        { section: 'شاشات المحل (تفتح في تبويب جديد)' },
        { label: 'شاشة التلفزيون', run: openScreen('display', 1, '/display') },
        { label: 'تابلت الباب (الكشك)', run: openScreen('kiosk', 2, '/kiosk') },
        { label: 'تابلت كرسي عم سيد (PIN 1111)', run: openScreen('chair', 3, '/chair') },
        { label: 'تطبيق الزبون', run: (api) => api.open(`/app/s/${SHOP_SLUG}`) },
        { section: 'جرّب' },
        { label: 'حرّك الطابور خطوة', run: stepQueue },
      ],
      note: `أو سجّل دخول بـ owner@naeeman.demo أو manager@naeeman.demo أو reception@naeeman.demo وكلمة المرور ${DEMO_PASSWORD}. البريد والإشعارات مش بيتبعتوا في النسخة دي.`,
    };
  },
});
