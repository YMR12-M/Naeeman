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
  ]),

  cashier: new Set([
    'shop.read', 'services.read', 'barbers.read', 'barbers.status',
    'queue.read', 'queue.write',
  ]),
};

export const can = (role, permission) => ROLE_PERMISSIONS[role]?.has(permission) ?? false;

/** الصلاحيات التي تُرسَل للواجهة لتُخفي ما لا يحقّ للمستخدم رؤيته */
export const permissionsOf = (role) => [...(ROLE_PERMISSIONS[role] ?? [])];
