/* ============================================
   نعيمًا التجريبي - بيانات «صالون الأمل» الوهمية
   محل حلاقة مصري: 4 حلاقين، وقايمة أسعار، ومنتجات، وزباين بكروت أختام،
   و10 أيام فاتوا (أدوار خلصت وفواتير ودرج وتقفيل كل يوم)، والنهارده:
   الدرج مفتوح، و3 على الكراسي، وطابور مستني فيه زبون من التطبيق.
   الأرقام متولّدة بمولّد ثابت، فكل زائر بيشوف نفس المحل.
   ============================================ */
import { addDays, zonedToUtc } from '../../../server/src/utils/dates.js';
import { applyRate } from '../../../server/src/utils/money.js';
import { MINUTE, insert, nowIso, todayOf } from './base.js';

export const DEMO_PASSWORD = 'Naeeman@2026';
export const SHOP_SLUG = 'elamal';
/**
 * المحل ماشي على ساعة الزائر نفسه: مواعيده 8 الصبح لحد 4 الفجر، فالزائر
 * بيلاقيه فاتح في أي وقت صاحي فيه (وفي الحقيقة المحل بياخد منطقته من الإعدادات).
 */
function visitorZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo';
  } catch (e) {
    return 'Africa/Cairo';
  }
}
const OPENS = 8 * 60;

/* مولّد أرقام ثابت (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['أحمد', 'محمد', 'محمود', 'مصطفى', 'عمر', 'يوسف', 'كريم', 'خالد', 'حسن', 'علي', 'إبراهيم', 'طارق', 'شريف', 'هشام', 'وليد',
  'مازن', 'زياد', 'سيف', 'آدم', 'مروان', 'عبدالرحمن', 'أسامة', 'حازم', 'رامي', 'تامر', 'باسم', 'نادر', 'ياسين'];
const LAST = ['سمير', 'عادل', 'فتحي', 'منصور', 'الشافعي', 'رضا', 'جمال', 'نبيل', 'صلاح', 'عبدالله', 'حمدي', 'عزت', 'فاروق', 'السيد', 'لطفي'];
const NOTES = [
  'بيحب الجوانب قصيرة جدًا ودرجة 2', 'ماكينة 3 من ورا والمقص من فوق', 'دقنه حسّاسة — موس جديد', 'مستعجل دايمًا، شغل سريع',
  'بيحب يتكلم كورة — أهلاوي', 'شعره خفيف من قدّام، بلاش تقصير زيادة', 'بيجيب ابنه معاه يوم الجمعة', null, null, null,
];

export function seed(db) {
  const now = Date.now();
  const TZ = visitorZone();
  const today = todayOf({ hours: HOURS, shop: { timezone: TZ } });
  const rand = rng(20261109);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

  Object.assign(db, {
    seedDay: today,
    version: 1,
    counters: {},
    stats: {},
    cookies: { staff: null, customer: null },
    users: [], barbers: [], services: [], tickets: [], ticketEvents: [], customers: [], cards: [], loyaltyEvents: [], photos: [],
    linkCodes: [], recoveryCodes: [], bills: [], payments: [], methods: [], drawers: [], cashMoves: [], dayCloses: [],
    products: [], stockMoves: [], barberDays: [], settlements: [], devices: [], pairings: [], audit: [],
  });

  db.shop = {
    id: 1, uuid: 'b6b1c1d2-0a8e-4c55-9b0b-5a1e0c2d7f10', name: 'صالون الأمل', slug: SHOP_SLUG, phone: '+201001234567', whatsapp: '+201001234567',
    address: '٤٥ شارع شبرا، أمام محطة المترو', city: 'القاهرة', latitude: 30.0801, longitude: 31.2453, timezone: TZ, currency: 'EGP',
    accepting_tickets: true, status: 'active', created_at: nowIso(now - 60 * 86_400_000), updated_at: nowIso(now - 3 * 86_400_000),
    checkin_secret: 'elamal-demo',
  };
  db.hours = HOURS.slice();
  db.settings = {
    remote_tickets_enabled: true, max_tickets_per_day: null, notify_ahead: 2, grace_minutes: 10, max_delays: 2, close_buffer_minutes: 15,
    display_name_style: 'first_initial', cashier_enabled: true, max_cashier_discount_pct: 10, receipt_width: 80,
    receipt_footer: 'نعيمًا — نوّرتنا، ومستنيينك المرّة الجاية', receipt_auto_print: false, loyalty_enabled: true, loyalty_stamps_required: 9,
    loyalty_reward_type: 'top_service', loyalty_reward_service_id: null, loyalty_reward_value: 0, loyalty_min_total: 0,
    reminder_enabled: true, reminder_days: 21,
  };

  /* --- الفريق --- */
  const created = nowIso(now - 60 * 86_400_000);
  [
    { full_name: 'حسن عبدالعزيز', email: 'owner@naeeman.demo', role: 'owner', phone: '+201001234567' },
    { full_name: 'كريم فوزي', email: 'manager@naeeman.demo', role: 'manager', phone: '+201112223344' },
    { full_name: 'منى سعيد', email: 'reception@naeeman.demo', role: 'cashier', phone: '+201223334455' },
  ].forEach((u, i) => insert(db, 'users', Object.assign(u, {
    uuid: `00000000-0000-4000-8000-00000000000${i + 1}`, status: 'active', password: DEMO_PASSWORD, must_change_password: false,
    last_login_at: nowIso(now - (i + 1) * 3_600_000), created_at: created, deleted_at: null,
  })));

  /* --- الحلاقين --- */
  const BARBERS = [
    { name: 'عم سيد', chair_no: 1, pin: '1111', pay_type: 'commission', service_pct: 5000, product_pct: 1000, daily_wage: 0, rent_amount: 0, rent_period: 'month' },
    { name: 'محمود الشريف', chair_no: 2, pin: '2222', pay_type: 'commission', service_pct: 4000, product_pct: 1000, daily_wage: 0, rent_amount: 0, rent_period: 'month' },
    { name: 'إسلام رجب', chair_no: 3, pin: '3333', pay_type: 'salary', service_pct: 1000, product_pct: 500, daily_wage: 25000, rent_amount: 0, rent_period: 'month' },
    { name: 'يوسف عاطف', chair_no: 4, pin: '4444', pay_type: 'chair_rent', service_pct: 10000, product_pct: 0, daily_wage: 0, rent_amount: 70000, rent_period: 'week' },
  ];
  BARBERS.forEach((b, i) => insert(db, 'barbers', Object.assign(b, {
    status: i === 3 ? 'off' : 'available', break_until: null, photo_path: null, sort_order: (i + 1) * 10, archived_at: null,
    failed_pins: 0, pin_locked_until: null, tips_to_barber: true, created_at: created, updated_at: created,
  })));

  /* --- الخدمات --- */
  [
    ['قص شعر', 15000, 30], ['دقن', 8000, 15], ['قص + دقن', 20000, 40], ['حلاقة أطفال', 10000, 20],
    ['تنظيف بشرة', 25000, 30], ['صبغة', 30000, 45], ['سشوار', 7000, 15], ['ماسك وبخار', 12000, 20],
  ].forEach(([name, price, minutes], i) => insert(db, 'services', {
    name, price, default_minutes: minutes, active: true, sort_order: (i + 1) * 10, archived_at: null, created_at: created, updated_at: created,
  }));
  const svc = (name) => db.services.find((s) => s.name === name);
  // مدّة متعلّمة عند عم سيد ومحمود (أسرع من الافتراضي)
  db.stats['1:1'] = { avg_minutes: 24, samples: 31 };
  db.stats['1:3'] = { avg_minutes: 35, samples: 22 };
  db.stats['2:1'] = { avg_minutes: 28, samples: 18 };

  /* --- طرق الدفع --- */
  [['cash', 'كاش', 'cash'], ['card', 'فيزا', 'card'], ['wallet', 'محفظة', 'wallet'], ['instapay', 'إنستاباي', 'transfer']]
    .forEach(([code, label, kind], i) => insert(db, 'methods', { code, label, kind, active: true, sort_order: (i + 1) * 10 }));
  const method = (code) => db.methods.find((m) => m.code === code);

  /* --- المنتجات --- */
  [
    ['جل شعر قوي', '6221234500011', 6500, 3800, 14, 5], ['شمع شعر مطفي', '6221234500028', 9000, 5200, 4, 5], ['زيت دقن', '6221234500035', 12000, 6500, 9, 4],
    ['شامبو ضد القشرة', '6221234500042', 11000, 7000, 7, 3], ['كريم بعد الحلاقة', '6221234500059', 8000, 4500, 11, 4], ['مشط خشب', null, 4000, 1500, 20, null],
  ].forEach(([name, barcode, price, cost, qty, low], i) => {
    const p = insert(db, 'products', {
      name, barcode, price, cost, track_stock: true, stock_qty: qty, low_stock_at: low, active: true, sort_order: (i + 1) * 10,
      archived_at: null, created_at: created, updated_at: created,
    });
    insert(db, 'stockMoves', { product_id: p.id, type: 'purchase', qty: qty + 6, unit_cost: cost, stock_after: qty + 6, bill_id: null, note: 'رصيد أوّل', created_by: 1, created_at: created });
  });

  /* --- حسابات التطبيق --- */
  const ahmed = insert(db, 'customers', { uuid: 'c1', name: 'أحمد سمير', phone: '+201001112233', email: 'ahmed@naeeman.demo', password: DEMO_PASSWORD, status: 'active', created_at: nowIso(now - 40 * 86_400_000), push: false });
  const omar = insert(db, 'customers', { uuid: 'c2', name: 'عمر خالد', phone: '+201005556677', email: null, password: DEMO_PASSWORD, status: 'active', created_at: nowIso(now - 12 * 86_400_000), push: false });

  /* --- كروت الزباين --- */
  const card = (fields) => insert(db, 'cards', Object.assign({
    shop_id: 1, customer_id: null, phone: null, notes: null, stamps: 0, rewards_redeemed: 0, visits: 0, total_spent: 0,
    first_visit_at: null, last_visit_at: null, last_barber_id: null, reminded_at: null, reminders_off: false, created_at: created, updated_at: created,
  }, fields));
  const ahmedCard = card({ customer_id: ahmed.id, name: ahmed.name, notes: 'ماكينة 2 على الجوانب، والمقص من فوق. بيحب الدقن مظبوطة على الخط' });
  const omarCard = card({ customer_id: omar.id, name: omar.name });
  const walkIns = [];
  for (let i = 0; i < 26; i += 1) {
    // أسامي مختلفة كلها (ومن غير «أحمد سمير» و«عمر خالد» بتوع التطبيق)
    walkIns.push(card({
      name: `${FIRST[(i + 2) % FIRST.length]} ${LAST[(i * 4 + 1) % LAST.length]}`,
      phone: `+2010${String(20000000 + i * 137731).slice(0, 8)}`,
      notes: NOTES[i % NOTES.length],
    }));
  }
  // كارت موبايل قديم لرقم عمر (عشان «ربط بالتطبيق» بكود من الاستقبال)
  const omarPhoneCard = card({ name: 'عمر خالد', phone: omar.phone, notes: 'بيحب السشوار بعد القص' });

  /* --- الأيام اللي فاتت --- */
  const HISTORY_DAYS = 10;
  const cardPool = [ahmedCard, omarPhoneCard].concat(walkIns);
  const doneByCard = new Map();
  const at = (date, minutesFromNoon) => zonedToUtc(date, '12:00', TZ).getTime() + minutesFromNoon * MINUTE;

  function makeDoneTicket({ date, startMs, barber, services, cardRow, source, number, waitMin }) {
    const createdMs = startMs - waitMin * MINUTE;
    const minutes = services.reduce((s, x) => s + x.default_minutes, 0);
    const finishMs = startMs + Math.max(10, minutes + between(-6, 8)) * MINUTE;
    db.seq.ticketServices = db.seq.ticketServices || 0;
    const t = insert(db, 'tickets', {
      shop_id: 1, business_date: date, number, customer_id: cardRow && cardRow.customer_id ? cardRow.customer_id : null,
      shop_customer_id: cardRow ? cardRow.id : null, name: cardRow ? cardRow.name : 'زبون', phone: cardRow ? cardRow.phone : null, source,
      preferred_barber_id: rand() < 0.4 ? barber.id : null, barber_id: barber.id, status: 'done', sort_key: number * 1000,
      arrived_at: nowIso(source === 'app' ? createdMs + 20 * MINUTE : createdMs), called_at: nowIso(startMs - MINUTE), delays_used: 0,
      auto_delayed: false, trust_confirm_required: false, confirmed_at: source === 'app' ? nowIso(createdMs) : null, near_notified_at: null,
      started_at: nowIso(startMs), finished_at: nowIso(finishMs), total: services.reduce((s, x) => s + x.price, 0), ended_by: 'chair',
      end_reason: null, created_at: nowIso(createdMs),
      services: services.map((s) => {
        db.seq.ticketServices += 1;
        return { id: db.seq.ticketServices, service_id: s.id, name: s.name, price: s.price, minutes: s.default_minutes, added_by: source };
      }),
    });
    return { t, finishMs };
  }

  function payBill({ t, finishMs, drawer, product, tip, methodCode, closeId }) {
    const b = insert(db, 'bills', {
      shop_id: 1, business_date: t.business_date, number: t.number, source: 'ticket', ticket_id: t.id, shop_customer_id: t.shop_customer_id,
      customer_name: t.name, customer_phone: t.phone, barber_id: t.barber_id, status: 'paid', subtotal: 0, discount: 0, discount_reason: null,
      reward_discount: 0, total: 0, tip: tip || 0, paid: 0, change_given: 0, refunded: 0, stamp_awarded: false, reward_redeemed: false,
      auto_paid: false, paid_date: t.business_date, paid_at: nowIso(finishMs + 2 * MINUTE), paid_by: 3, voided_at: null, voided_by: null,
      void_reason: null, created_by: null, day_close_id: closeId, tip_settlement_id: null, created_at: nowIso(finishMs), updated_at: nowIso(finishMs), items: [],
    });
    const barber = db.barbers.find((x) => x.id === t.barber_id);
    t.services.forEach((s) => {
      db.seq.billItems = (db.seq.billItems || 0) + 1;
      b.items.push({
        id: db.seq.billItems, kind: 'service', service_id: s.service_id, product_id: null, ticket_service_id: s.id, name: s.name, unit_price: s.price,
        qty: 1, line_total: s.price, barber_id: t.barber_id, unit_cost: null, discount_share: 0, reward_share: 0, commission_rate: barber.service_pct,
        commission: applyRate(s.price, barber.service_pct), settlement_id: null, added_by: 'ticket', created_at: nowIso(finishMs),
      });
    });
    if (product) {
      db.seq.billItems += 1;
      b.items.push({
        id: db.seq.billItems, kind: 'product', service_id: null, product_id: product.id, ticket_service_id: null, name: product.name,
        unit_price: product.price, qty: 1, line_total: product.price, barber_id: t.barber_id, unit_cost: product.cost, discount_share: 0,
        reward_share: 0, commission_rate: barber.product_pct, commission: applyRate(product.price, barber.product_pct), settlement_id: null,
        added_by: 'staff', created_at: nowIso(finishMs),
      });
      insert(db, 'stockMoves', { product_id: product.id, type: 'sale', qty: -1, unit_cost: null, stock_after: product.stock_qty, bill_id: b.id, note: null, created_by: 3, created_at: nowIso(finishMs) });
    }
    b.subtotal = b.items.reduce((s, i) => s + i.line_total, 0);
    // مكافأة الأختام: لو الكارت وصل 9، أغلى خدمة ببلاش
    const cardRow = t.shop_customer_id ? db.cards.find((c) => c.id === t.shop_customer_id) : null;
    if (cardRow && cardRow.stamps >= 9) {
      const top = b.items.filter((i) => i.kind === 'service').sort((x, y) => y.unit_price - x.unit_price)[0];
      b.reward_discount = top.unit_price;
      top.reward_share = top.unit_price;
      b.reward_redeemed = true;
      cardRow.stamps -= 9;
      cardRow.rewards_redeemed += 1;
      insert(db, 'loyaltyEvents', { shop_customer_id: cardRow.id, bill_id: b.id, type: 'redeem', delta: -9, stamps_after: cardRow.stamps, note: 'أغلى خدمة في الزيارة ببلاش', created_by: 3, created_at: b.paid_at });
    }
    b.total = b.subtotal - b.reward_discount;
    b.paid = b.total + b.tip;
    const m = method(methodCode);
    if (b.paid > 0) {
      insert(db, 'payments', {
        shop_id: 1, bill_id: b.id, drawer_session_id: m.kind === 'cash' || drawer ? drawer.id : null, business_date: t.business_date, kind: 'payment',
        method_code: m.code, method_label: m.label, method_kind: m.kind, amount: b.paid, tendered: m.kind === 'cash' ? Math.ceil(b.paid / 5000) * 5000 : null,
        reference: null, reason: null, created_by: 3, created_at: b.paid_at, day_close_id: closeId,
      });
    }
    if (m.kind === 'cash') b.change_given = Math.ceil(b.paid / 5000) * 5000 - b.paid;
    if (cardRow) {
      cardRow.visits += 1;
      cardRow.total_spent += b.total;
      cardRow.first_visit_at = cardRow.first_visit_at || t.finished_at;
      cardRow.last_visit_at = t.finished_at;
      cardRow.last_barber_id = t.barber_id;
      if (!b.reward_redeemed) {
        cardRow.stamps += 1;
        b.stamp_awarded = true;
        insert(db, 'loyaltyEvents', { shop_customer_id: cardRow.id, bill_id: b.id, type: 'earn', delta: 1, stamps_after: cardRow.stamps, note: null, created_by: 3, created_at: b.paid_at });
      }
      doneByCard.set(cardRow.id, t);
    }
    return b;
  }

  const SERVICE_MIX = ['قص شعر', 'قص شعر', 'قص + دقن', 'قص + دقن', 'دقن', 'حلاقة أطفال', 'قص شعر', 'تنظيف بشرة', 'صبغة'];
  // الزباين اللي آخر زيارة ليهم قديمة (للتذكير «وحشونا»): ما بيجوش في آخر الأيام
  const longGone = new Set(walkIns.slice(20, 26).map((c) => c.id));
  // كروت قديمة جدًا (من الشهر اللي فات) عشان التذكير
  walkIns.slice(20, 26).forEach((c, i) => {
    const visit = nowIso(now - (24 + i * 3) * 86_400_000);
    Object.assign(c, { visits: 2 + (i % 3), total_spent: 30000 + i * 5000, first_visit_at: nowIso(now - 70 * 86_400_000), last_visit_at: visit, last_barber_id: 1 + (i % 3), stamps: 2 + (i % 3) });
  });

  for (let d = HISTORY_DAYS; d >= 1; d -= 1) {
    const date = addDays(today, -d);
    const closeId = d;
    const openMs = at(date, -30);
    const drawer = insert(db, 'drawers', {
      business_date: date, status: 'closed', opening_float: 50000, opened_at: nowIso(openMs), opened_by: 3, expected_cash: null,
      counted_cash: null, variance: null, closed_at: null, closed_by: 3, note: null, day_close_id: closeId,
    });
    const working = [1, 2, 3].concat(d % 3 === 0 ? [] : [4]);
    working.forEach((bid) => db.barberDays.push({ barber_id: bid, business_date: date, settlement_id: null }));
    const free = {};
    working.forEach((bid) => { free[bid] = at(date, between(0, 40)); });
    const count = between(13, 21);
    let number = 0;
    for (let i = 0; i < count; i += 1) {
      const bid = working.reduce((best, x) => (free[x] < free[best] ? x : best), working[0]);
      const barber = db.barbers.find((x) => x.id === bid);
      const mix = pick(SERVICE_MIX);
      const services = [svc(mix)].concat(rand() < 0.15 ? [svc('سشوار')] : []);
      let cardRow = null;
      if (rand() < 0.7) {
        cardRow = pick(cardPool);
        if (longGone.has(cardRow.id) || (doneByCard.get(cardRow.id) && doneByCard.get(cardRow.id).business_date === date)) cardRow = null;
      }
      const source = cardRow && cardRow.customer_id ? 'app' : rand() < 0.5 ? 'kiosk' : 'staff';
      number += 1;
      const startMs = free[bid] + between(0, 12) * MINUTE;
      const { t, finishMs } = makeDoneTicket({ date, startMs, barber, services, cardRow, source, number, waitMin: between(4, 26) });
      free[bid] = finishMs + between(2, 10) * MINUTE;
      const product = rand() < 0.18 ? pick(db.products) : null;
      const r = rand();
      const methodCode = r < 0.62 ? 'cash' : r < 0.78 ? 'wallet' : r < 0.9 ? 'instapay' : 'card';
      payBill({ t, finishMs, drawer, product, tip: rand() < 0.3 ? pick([1000, 2000, 2000, 5000]) : 0, methodCode, closeId });
    }
    // مصروف وسلفة أحيانًا
    if (d % 2 === 0) {
      insert(db, 'cashMoves', { drawer_session_id: drawer.id, business_date: date, type: 'expense', amount: pick([3500, 5000, 8000]), barber_id: null, note: pick(['شاي وقهوة', 'مناديل وفوط', 'كهربا الشهر']), settlement_id: null, created_by: 3, created_at: nowIso(at(date, 200)), day_close_id: closeId });
    }
    if (d === 4) {
      insert(db, 'cashMoves', { drawer_session_id: drawer.id, business_date: date, type: 'advance', amount: 20000, barber_id: 2, note: 'سلفة', settlement_id: null, created_by: 2, created_at: nowIso(at(date, 300)), day_close_id: closeId });
    }
    // قفل الدرج بعدّ الكاش (فرق صغير أحيانًا)
    const cash = db.payments.filter((p) => p.drawer_session_id === drawer.id && p.method_kind === 'cash').reduce((s, p) => s + p.amount, 0);
    const out = db.cashMoves.filter((m) => m.drawer_session_id === drawer.id).reduce((s, m) => s + m.amount, 0);
    const expected = drawer.opening_float + cash - out;
    const variance = d === 6 ? -2000 : d === 3 ? 500 : 0;
    Object.assign(drawer, { expected_cash: expected, counted_cash: expected + variance, variance, closed_at: nowIso(at(date, 12 * 60 - 5)) });
  }

  // تقفيل كل يوم فات (Z): ملخّص ثابت محسوب من بيانات اليوم
  for (let d = HISTORY_DAYS; d >= 1; d -= 1) {
    const date = addDays(today, -d);
    db.dayCloses.push({ id: d, shop_id: 1, number: HISTORY_DAYS - d + 1, business_date: date, period_start: null, period_end: nowIso(at(date, 12 * 60)), summary: null, note: null, closed_by: 1, created_at: nowIso(at(date, 12 * 60)) });
  }
  db.seq.dayCloses = HISTORY_DAYS;
  db.counters.day_close = HISTORY_DAYS;

  // حساب الحلاقين: آخر حساب كان من 6 أيام (فاللي بعده مفتوح)
  const settleTo = addDays(today, -6);
  db.barbers.forEach((b) => {
    const lines = [];
    db.bills.forEach((bill) => {
      if (bill.paid_date > settleTo) return;
      bill.items.forEach((item) => { if (item.barber_id === b.id) lines.push({ bill, item }); });
    });
    const days = db.barberDays.filter((x) => x.barber_id === b.id && x.business_date <= settleTo);
    if (!lines.length && !days.length) return;
    const net = (i) => i.line_total - i.discount_share - i.reward_share;
    const sumKind = (kind, f) => lines.filter((x) => x.item.kind === kind).reduce((s, x) => s + f(x.item), 0);
    const tips = db.bills.filter((x) => x.barber_id === b.id && x.paid_date <= settleTo).reduce((s, x) => s + x.tip, 0);
    const periodDays = days.length ? Math.round((Date.parse(settleTo) - Date.parse(days[0].business_date)) / 86_400_000) + 1 : 1;
    const rent = b.rent_amount ? Math.round((b.rent_amount * periodDays) / 7) : 0;
    const wages = days.length * b.daily_wage;
    const advances = db.cashMoves.filter((m) => m.barber_id === b.id && m.type === 'advance' && m.business_date <= settleTo).reduce((s, m) => s + m.amount, 0);
    const sc = sumKind('service', (i) => i.commission);
    const pc = sumKind('product', (i) => i.commission);
    const s = insert(db, 'settlements', {
      shop_id: 1, barber_id: b.id, period_from: days.length ? days[0].business_date : settleTo, period_to: settleTo,
      pay_snapshot: { pay_type: b.pay_type, service_pct: b.service_pct, product_pct: b.product_pct, daily_wage: b.daily_wage, rent_amount: b.rent_amount, rent_period: b.rent_period, tips_to_barber: true },
      days_worked: days.length, services_total: sumKind('service', net), products_total: sumKind('product', net), service_commission: sc,
      product_commission: pc, wages, tips, rent, advances, net: wages + sc + pc + tips - rent - advances, settled_via: 'outside', note: null,
      cash_movement_id: null, created_by: 1, created_at: nowIso(at(settleTo, 12 * 60 + 10)),
    });
    lines.forEach((x) => { x.item.settlement_id = s.id; });
    db.bills.forEach((x) => { if (x.barber_id === b.id && x.paid_date <= settleTo && x.tip > 0) x.tip_settlement_id = s.id; });
    days.forEach((x) => { x.settlement_id = s.id; });
    db.cashMoves.forEach((m) => { if (m.barber_id === b.id && m.type === 'advance' && m.business_date <= settleTo) m.settlement_id = s.id; });
  });

  /* --- النهارده --- */
  const nowCairoMinutes = Math.floor((now - zonedToUtc(today, '00:00', TZ).getTime()) / MINUTE);
  // من الفتح (أو آخر 7 ساعات)، ولو المحل لسه فاتح دلوقتي حالًا: من نص ساعة
  const dayStart = Math.min(Math.max(OPENS, nowCairoMinutes - 7 * 60), Math.max(0, nowCairoMinutes - 30));
  const openToday = insert(db, 'drawers', {
    business_date: today, status: 'open', opening_float: 50000, opened_at: nowIso(zonedToUtc(today, '00:00', TZ).getTime() + dayStart * MINUTE),
    opened_by: 3, expected_cash: null, counted_cash: null, variance: null, closed_at: null, closed_by: null, note: null, day_close_id: null,
  });
  [1, 2, 3].forEach((bid) => db.barberDays.push({ barber_id: bid, business_date: today, settlement_id: null }));

  // اللي خلصوا النهارده بدري (لو اليوم بدأ من بدري كفاية)
  let number = 0;
  const free = { 1: now - (nowCairoMinutes - dayStart) * MINUTE, 2: now - (nowCairoMinutes - dayStart - 15) * MINUTE, 3: now - (nowCairoMinutes - dayStart - 30) * MINUTE };
  const stopAt = now - 45 * MINUTE;
  for (let guard = 0; guard < 30; guard += 1) {
    const bid = [1, 2, 3].reduce((best, x) => (free[x] < free[best] ? x : best), 1);
    if (free[bid] > stopAt - 30 * MINUTE) break;
    const barber = db.barbers.find((x) => x.id === bid);
    let cardRow = rand() < 0.65 ? pick(walkIns.slice(0, 20)) : null;
    if (cardRow && doneByCard.get(cardRow.id) && doneByCard.get(cardRow.id).business_date === today) cardRow = null;
    number += 1;
    const services = [svc(pick(SERVICE_MIX))];
    const { t, finishMs } = makeDoneTicket({ date: today, startMs: free[bid], barber, services, cardRow, source: rand() < 0.5 ? 'kiosk' : 'staff', number, waitMin: between(3, 18) });
    if (finishMs > stopAt) {
      db.tickets.pop();
      number -= 1;
      break;
    }
    free[bid] = finishMs + between(2, 8) * MINUTE;
    const r = rand();
    payBill({ t, finishMs, drawer: openToday, product: rand() < 0.15 ? pick(db.products) : null, tip: rand() < 0.3 ? 2000 : 0, methodCode: r < 0.65 ? 'cash' : r < 0.85 ? 'wallet' : 'instapay', closeId: null });
  }
  insert(db, 'cashMoves', { drawer_session_id: openToday.id, business_date: today, type: 'expense', amount: 4000, barber_id: null, note: 'شاي وقهوة للزباين', settlement_id: null, created_by: 3, created_at: nowIso(now - 2 * 3_600_000), day_close_id: null });

  // صور قصّات على الكروت
  [ahmedCard, walkIns[0], walkIns[2], walkIns[5], omarPhoneCard].forEach((c, i) => {
    const t = db.tickets.filter((x) => x.shop_customer_id === c.id).slice(-1)[0];
    if (!t) return;
    insert(db, 'photos', {
      shop_customer_id: c.id, ticket_id: t.id, barber_id: t.barber_id, mime: 'image/svg+xml', bytes: 2400, data: null, art: i * 3 + 1,
      label: c.name.split(' ')[0], taken_by: 'chair', taken_by_id: 3, created_at: t.finished_at, deleted_at: null,
    });
  });

  // اللي على الكراسي دلوقتي
  const ticketRow = (fields) => {
    number += 1;
    const services = fields.services.map((name) => svc(name));
    db.seq.ticketServices = db.seq.ticketServices || 0;
    const row = insert(db, 'tickets', Object.assign({
      shop_id: 1, business_date: today, number, customer_id: null, shop_customer_id: null, name: 'زبون', phone: null, source: 'kiosk',
      preferred_barber_id: null, barber_id: null, status: 'waiting', sort_key: number * 1000, arrived_at: null, called_at: null, delays_used: 0,
      auto_delayed: false, trust_confirm_required: false, confirmed_at: null, near_notified_at: null, started_at: null, finished_at: null,
      total: services.reduce((s, x) => s + x.price, 0), ended_by: null, end_reason: null, created_at: nowIso(now - 30 * MINUTE),
    }, fields, {
      services: services.map((s) => {
        db.seq.ticketServices += 1;
        return { id: db.seq.ticketServices, service_id: s.id, name: s.name, price: s.price, minutes: s.default_minutes, added_by: fields.source || 'kiosk' };
      }),
    }));
    insert(db, 'ticketEvents', { ticket_id: row.id, type: 'created', actor_type: row.source === 'staff' ? 'staff' : row.source === 'app' ? 'customer' : 'kiosk', actor_id: row.source === 'kiosk' ? 2 : 3, data: { source: row.source, number: row.number }, created_at: row.created_at });
    return row;
  };
  const fromCard = (c) => ({ shop_customer_id: c.id, name: c.name, phone: c.phone });
  ticketRow(Object.assign(fromCard(walkIns[3]), { services: ['قص + دقن'], status: 'serving', barber_id: 1, started_at: nowIso(now - 22 * MINUTE), arrived_at: nowIso(now - 40 * MINUTE), called_at: nowIso(now - 22 * MINUTE), created_at: nowIso(now - 40 * MINUTE) }));
  ticketRow({ services: ['دقن'], status: 'serving', barber_id: 2, name: 'زبون', started_at: nowIso(now - 6 * MINUTE), arrived_at: nowIso(now - 25 * MINUTE), called_at: nowIso(now - 6 * MINUTE), created_at: nowIso(now - 25 * MINUTE) });
  ticketRow(Object.assign(fromCard(walkIns[8]), { services: ['قص شعر'], status: 'serving', barber_id: 3, started_at: nowIso(now - 14 * MINUTE), arrived_at: nowIso(now - 30 * MINUTE), called_at: nowIso(now - 14 * MINUTE), created_at: nowIso(now - 30 * MINUTE), source: 'staff' }));

  // الطابور المستني
  ticketRow(Object.assign(fromCard(walkIns[11]), { services: ['قص شعر'], arrived_at: nowIso(now - 20 * MINUTE), created_at: nowIso(now - 20 * MINUTE), source: 'kiosk' }));
  ticketRow(Object.assign(fromCard(walkIns[0]), { services: ['قص + دقن'], preferred_barber_id: 1, arrived_at: nowIso(now - 17 * MINUTE), created_at: nowIso(now - 17 * MINUTE), source: 'staff' }));
  ticketRow({ name: 'زبون', services: ['حلاقة أطفال'], arrived_at: nowIso(now - 12 * MINUTE), created_at: nowIso(now - 12 * MINUTE), source: 'kiosk' });
  ticketRow({ customer_id: omar.id, shop_customer_id: omarCard.id, name: omar.name, phone: omar.phone, services: ['قص شعر', 'سشوار'], source: 'app', created_at: nowIso(now - 9 * MINUTE), confirmed_at: nowIso(now - 9 * MINUTE) });
  ticketRow(Object.assign(fromCard(walkIns[14]), { services: ['تنظيف بشرة'], arrived_at: nowIso(now - 5 * MINUTE), created_at: nowIso(now - 5 * MINUTE), source: 'kiosk' }));
  ticketRow(Object.assign(fromCard(walkIns[6]), { services: ['دقن'], preferred_barber_id: 2, arrived_at: nowIso(now - 2 * MINUTE), created_at: nowIso(now - 2 * MINUTE), source: 'staff' }));
  db.counters[`ticket:${today}`] = number;
  db.version = 1;

  // أرقام الفواتير لكل يوم
  db.bills.forEach((b) => {
    const key = `bill:${b.business_date}`;
    db.counters[key] = Math.max(db.counters[key] || 0, b.number);
  });

  /* --- الأجهزة --- */
  const device = (type, name, barberId) => insert(db, 'devices', {
    type, name, token: `dv.${type}.demo${db.devices.length + 1}`, created_at: created, last_seen_at: nowIso(now - 60_000), current_barber_id: barberId || null, revoked_at: null,
  });
  device('display', 'شاشة الصالة');
  device('kiosk', 'تابلت الباب');
  device('chair', 'تابلت كرسي ١', 1);
  device('chair', 'تابلت كرسي ٢', 2);

  /* --- السجل --- */
  const log = (user, action, entity, entityId, after, minutesAgo) => insert(db, 'audit', {
    action, entity, entity_id: entityId, before_json: null, after_json: after || null, ip: '192.168.1.20', created_at: nowIso(now - minutesAgo * MINUTE), user_id: user,
  });
  log(1, 'shop.settings', 'shop', 1, { loyalty_enabled: true, loyalty_stamps_required: 9 }, 60 * 24 * 5);
  log(1, 'barber.pin', 'barber', 4, null, 60 * 24 * 3);
  log(2, 'queue.move', 'ticket', 3, { from: 3, to: 1, reason: 'الزبون كبير في السن' }, 60 * 26);
  log(3, 'drawer.open', 'drawer', openToday.id, { opening_float: 50000 }, Math.max(30, nowCairoMinutes - dayStart));
  log(3, 'auth.login', 'user', 3, null, 25);
}

/* من 8 الصبح لحد 4 الفجر كل يوم (بساعة الزائر) */
const HOURS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '08:00', closes_at: '04:00' }));

/** ملخّص التقفيلات القديمة بعد ما الفواتير اتعملت (بيتحسب مرّة وقت التجهيز) */
export function finishSeed(db, periodSummary) {
  db.dayCloses.forEach((d) => {
    if (d.summary) return;
    d.summary = periodSummary(db, d.id);
    d.period_start = d.summary.period_start;
  });
}
