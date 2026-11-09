/**
 * ═══════════════════════════════════════════════════════════════
 *  الأدوار والصلاحيات (موظفو المحل)
 *
 *  الصلاحية نصّ بصيغة `مورد.إجراء`. الدور مجموعة صلاحيات ثابتة في الكود
 *  (لا جدول للأدوار): أبسط في المراجعة، ولا يمكن لخلل في البيانات أن
 *  يمنح أحدًا ما لم نقصده.
 *
 *  الحلاق والزبون والأجهزة مش هنا: كل واحد منهم ليه مصادقة خاصة
 *  وحدود ثابتة في مساراته (الحلاق يتحكّم في طابوره هو بس، والزبون في
 *  دوره هو بس، والجهاز في الشغلانة اللي اتربط عليها).
 * ═══════════════════════════════════════════════════════════════
 */

export const ROLES = ['owner', 'manager', 'cashier'];

export const ROLE_LABELS = {
  owner: 'مالك',
  manager: 'مدير',
  cashier: 'استقبال',
};

export const PERMISSIONS = [
  'shop.read', 'shop.write',
  'users.read', 'users.write',
  'services.read', 'services.write',
  'barbers.read', 'barbers.write', 'barbers.status',
  'devices.manage',
  // queue.write: زبون من الشارع، وصل، غيّر الحلاق، زوّد خدمة، ألغِ، ما جاش
  // queue.manage: تحريك دور لأي مكان في الطابور (بسبب مكتوب)
  'queue.read', 'queue.write', 'queue.manage',
  'reports.read',
  'audit.read',
  // ── المرحلة التانية ──
  // billing.use: فواتير ودفع ودرج وبيع منتج · billing.discount: خصم من غير حد
  // billing.refund: مرتجع وإلغاء فاتورة فيها سطور
  'billing.use', 'billing.discount', 'billing.refund',
  'drawer.expense', 'drawer.advance', 'dayclose.close',
  'payments.manage',
  'products.read', 'products.write', 'stock.write',
  'payroll.read', 'payroll.write',
  // cards.write: الملاحظات والصور · cards.stamps: تعديل الأختام يدوي
  'cards.read', 'cards.write', 'cards.stamps',
  // المحل هو السيرفر: عناوين الواي فاي والنسخ الاحتياطية والاسترجاع (المالك بس)
  'hub.manage',
];

const ALL = new Set(PERMISSIONS);

export const ROLE_PERMISSIONS = {
  owner: ALL,

  // المدير يدير الشغل اليومي كله، لكن الإعدادات والفريق والأجهزة والسجل للمالك
  manager: new Set([
    'shop.read',
    'services.read', 'services.write',
    'barbers.read', 'barbers.write', 'barbers.status',
    'queue.read', 'queue.write', 'queue.manage',
    'reports.read',
    'billing.use', 'billing.discount', 'billing.refund',
    'drawer.expense', 'drawer.advance', 'dayclose.close',
    'products.read', 'products.write', 'stock.write',
    'payroll.read',
    'cards.read', 'cards.write', 'cards.stamps',
  ]),

  cashier: new Set([
    'shop.read', 'services.read', 'barbers.read', 'barbers.status',
    'queue.read', 'queue.write',
    'billing.use', 'drawer.expense', 'products.read',
    'cards.read', 'cards.write',
  ]),
};

export const can = (role, permission) => ROLE_PERMISSIONS[role]?.has(permission) ?? false;

/** الصلاحيات التي تُرسَل للواجهة لتُخفي ما لا يحقّ للمستخدم رؤيته */
export const permissionsOf = (role) => [...(ROLE_PERMISSIONS[role] ?? [])];
