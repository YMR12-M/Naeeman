# نعيمًا — الـ API

كل المسارات تحت `/api/v1` (`API_PREFIX`)، وفحص الصحّة على `/health` من غير بادئة. القايمة دي مطلّعة من الكود نفسه (`server/src/routes/index.js` والموديولات).

## الأعراف

- **الردود:** نجاح `{ success: true, data }`، وفشل `{ success: false, message, code, errors?, path }`. الرسالة عربي جاهزة للعرض، و`code` ثابت للبرمجة (`TOKEN_EXPIRED`، `TOO_LATE`، `NO_DELAYS_LEFT`…)، و`errors` أخطاء الحقول من Zod.
- **المال** بالقروش (أعداد صحيحة)، والتواريخ `YYYY-MM-DD`، والأوقات ISO بتوقيت UTC.
- **نوع العميل** في ترويسة `X-Client-Type`: `web` (توكن التجديد في كوكي httpOnly)، أو `mobile` / `desktop` (التوكن في الجسم ويتخزّن في مخزن آمن). طلب التجديد بالكوكي لازم فيه الترويسة دي (حماية CSRF).
- **منع التكرار:** كل فعل بيغيّر الطابور بياخد `Idempotency-Key` (8 لـ 80 حرف). نفس المفتاح من نفس صاحب الطلب = نفس الرد من غير ما يتنفّذ تاني.
- **CORS:** قايمة صريحة من `CLIENT_ORIGIN` بكوكي، ما عدا `/public/*` مفتوح لأي موقع من غير كوكي.

## المصادقة — تلات أنواع

| مين | إزاي | الترويسة |
|---|---|---|
| موظف المحل | إيميل وكلمة سر ← توكن قصير (15 دقيقة) + تجديد دوّار | `Authorization: Bearer …` (جمهور `naeeman-staff`) |
| الزبون | موبايل وكلمة سر ← نفس الشكل في جداول منفصلة | `Authorization: Bearer …` (جمهور `naeeman-customer`) |
| جهاز المحل | كود ربط من 6 أرقام ← توكن طويل | `X-Device-Token: …` |

توكن الزبون ما بيفتحش مسارات الموظفين والعكس، وكل جهاز ليه شغلانة واحدة (`display` / `kiosk` / `chair`).

## المسارات

### دخول الموظفين — `/auth`
| | المسار | |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/refresh` · `/auth/logout` · `/auth/logout-all` | |
| POST | `/auth/forgot-password` · `/auth/reset-password` | رابط على البريد |
| GET · PATCH | `/auth/me` | |
| POST | `/auth/change-password` | بيفتح جلسة جديدة |
| GET · DELETE | `/auth/sessions` · `/auth/sessions/:familyId` | الأجهزة الداخلة |

### المحل والفريق (موظفين)
| | المسار | الصلاحية |
|---|---|---|
| GET · PATCH | `/shop` | `shop.read` · `shop.write` |
| GET · PUT | `/shop/hours` | `shop.read` · `shop.write` |
| GET · PATCH | `/shop/settings` | `shop.read` · `shop.write` |
| GET · POST | `/services` · `/services/bulk` | `services.read` · `services.write` |
| PUT | `/services/order` | `services.write` |
| PATCH · DELETE | `/services/:id` · POST `/services/:id/restore` | `services.write` |
| GET · POST | `/barbers` · PUT `/barbers/order` | `barbers.read` · `barbers.write` |
| PATCH · DELETE | `/barbers/:id` · PUT `/barbers/:id/pin` · POST `/barbers/:id/restore` | `barbers.write` |
| POST | `/barbers/:id/status` `{ status, break_minutes? }` | `barbers.status` |
| GET · POST | `/users` | `users.read` · `users.write` |
| GET · PATCH · DELETE | `/users/:id` · POST `/users/:id/temp-password` | `users.read` · `users.write` |
| GET | `/devices` · POST `/devices/pairing-code` `{ type, name? }` | `devices.manage` |
| PATCH · DELETE | `/devices/:id` | `devices.manage` |
| GET | `/reports/today?date=` | `reports.read` |
| GET | `/audit` | `audit.read` |
| POST | `/customers/recovery-code` `{ phone }` | `queue.write` |

### الكاشير والمخزن والحساب والكروت (المرحلة التانية)
المال بالقروش. الفاتورة هي مصدر الحقيقة للفلوس (التفاصيل في [`PLAN-2.md`](PLAN-2.md)).

| | المسار | الصلاحية |
|---|---|---|
| GET · POST | `/bills?status=&q=&date=` · `/bills` (بيع من غير دور) · POST `/bills/for-ticket/:ticketId` | `billing.use` |
| GET | `/bills/:id` · `/bills/:id/receipt` (بيانات الإيصال) | `billing.use` |
| POST · DELETE | `/bills/:id/items` · `/bills/:id/items/:itemId` | `billing.use` |
| POST | `/bills/:id/checkout` `{ payments:[{method,amount,tendered?,reference?}], tip?, discount?, discount_reason?, redeem_reward? }` (ذرّي) | `billing.use` (الخصم بحدّ للاستقبال، `billing.discount` من غير حد) |
| POST | `/bills/:id/void` `{ reason }` · `/bills/:id/refund` `{ amount, method, reason, restock?: [{ item_id, qty }] }` | `billing.use` · `billing.refund` |
| GET · POST · PATCH | `/payment-methods` | `billing.use` · `payments.manage` |
| GET | `/drawer/current` · `/drawer/sessions` · `/drawer/sessions/:id` | `billing.use` |
| POST | `/drawer/open` `{ opening_float }` · `/drawer/close` `{ counted_cash, note? }` | `billing.use` |
| POST | `/drawer/movements` `{ type: expense\|advance\|cash_in\|cash_out, amount, note?, barber_id? }` (صرف الحساب بيتسجّل من `/payroll/settlements`) | `drawer.expense` (السلفة `drawer.advance`) |
| GET · POST | `/day-close/preview` · `/day-close` `{ note? }` · GET `/day-close` · `/day-close/:id` | `dayclose.close` |
| GET · POST · PATCH · DELETE | `/products` · `/products/lookup?barcode=` · `/products/:id` · POST `/products/:id/restore` | `products.read` · `products.write` |
| POST · GET | `/products/:id/stock` `{ type: purchase\|use\|adjust, qty \| counted_qty, unit_cost?, note? }` · `/products/:id/movements` | `stock.write` · `products.read` |
| GET · PUT | `/payroll/barbers` · `/payroll/barbers/:id` (إعدادات الحساب) | `payroll.read` · `payroll.write` |
| GET | `/payroll/preview?barber_id=&to=` · `/payroll/settlements` · `/payroll/settlements/:id` | `payroll.read` |
| POST | `/payroll/settlements` `{ barber_id, to?, via: drawer\|outside, note? }` | `payroll.write` |
| GET | `/cards?q=` · `/cards/:id` · `/cards/reminders` (وحشونا) | `cards.read` |
| PATCH | `/cards/:id` `{ name?, notes?, reminders_off? }` · POST `/cards/:id/reminded` | `cards.write` |
| POST | `/cards/:id/stamps` `{ delta, note }` (تعديل يدوي) | `cards.stamps` |
| POST | `/cards/:id/link-code` ← `{ code, expires_in_minutes, card }` (كود ربط كارت الموبايل بحساب التطبيق: 6 أرقام، ربع ساعة، مرّة واحدة) | `cards.write` |
| GET | `/cards/:id/photos/:photoId` (الصورة، بتوكن) | `cards.read` |
| POST · DELETE | `/cards/:id/photos` (صورة خام: `Content-Type: image/jpeg\|png\|webp`) · `/cards/:id/photos/:photoId` | `cards.write` |
| GET | `/reports/today?date=` (من الفواتير: طرق الدفع والمنتجات) · `/reports/range?from=&to=` | `reports.read` |

### المحل هو السيرفر — `/hub` (المالك، `hub.manage`)
| | المسار | |
|---|---|---|
| GET | `/hub` | `{ enabled, addresses, api_port, customer_port, serves_panel, serves_customer, backup }`. برّه وضع المحل `enabled=false` |
| GET · POST | `/hub/backups` | قايمة النسخ (من غير مسارات الجهاز) · نسخة دلوقتي |
| POST | `/hub/backups/restore` `{ name, confirm: true }` | بيعمل نسخة أمان من الحالة الحالية، وبعدين بيمسح ويرجّع النسخة |

برّه وضع المحل (`HUB_MODE`) مسارات النسخ بترد `409 HUB_ONLY`.

### الطابور (موظفين)
| | المسار | الصلاحية |
|---|---|---|
| GET | `/queue?since=` · `/queue/stream` (SSE) · `/queue/tickets/:id` | `queue.read` |
| POST | `/queue/tickets` `{ service_ids, barber_id?, name?, phone? }` | `queue.write` |
| POST | `/queue/tickets/:id/arrive` · `/cancel` `{ reason? }` · `/no-show` · `/assign` `{ barber_id\|null }` · `/services` `{ service_id }` | `queue.write` |
| POST | `/queue/tickets/:id/move` `{ after_ticket_id, reason }` | `queue.manage` |
| POST | `/queue/barbers/:barberId/next` · `/finish` | `queue.write` |

### الزبون — `/customer-auth` و`/me`
| | المسار | |
|---|---|---|
| POST | `/customer-auth/register` `{ name, phone, password, email? }` · `/login` `{ phone, password }` | |
| POST | `/customer-auth/refresh` · `/logout` | |
| POST | `/customer-auth/forgot-password` `{ phone }` · `/reset-password` `{ token, new_password }` | بالبريد |
| POST | `/customer-auth/reset-with-code` `{ phone, code, new_password }` | بكود من المحل |
| GET · PATCH | `/me` · POST `/me/change-password` | |
| POST · DELETE | `/me/push-subscriptions` | Web Push |
| GET | `/me/tickets` (السجل) · `/me/tickets/active` · `/me/tickets/:id` | السجل فيه كمان زيارات الكارت اللي اترَبط (قراية بس) |
| POST | `/me/tickets` `{ shop_slug, service_ids, barber_id? }` | خُد دور |
| POST | `/me/tickets/:id/coming` · `/delay` · `/cancel` · `/check-in` `{ code }` | |
| GET · PATCH | `/me/cards` (كروت الأختام في كل محل زاره) · `/me/cards/:shopId` `{ reminders_off }` | بيظهر الكارت بعد أوّل دور بالتطبيق في المحل |
| POST | `/me/cards/link` `{ code }` | يربط كارت الموبايل القديم (بنفس رقم الحساب) بكود من الاستقبال، والكارتين بيتدمجوا. 5 محاولات غلط والكود يتحرق |
| GET · DELETE | `/me/photos` · `/me/photos/:id` (قصّاته، وبيمسحها) | الصورة بتوكنه هو بس |
| GET | `/me/stream` (SSE) | الدور الشغّال لايف |

### الأجهزة
| | المسار | |
|---|---|---|
| POST | `/devices/pair` `{ code }` | من غير توكن ← توكن الجهاز |
| GET | `/display/queue` · `/display/stream` | التلفزيون |
| GET · POST | `/kiosk/options` · `/kiosk/tickets` · `/kiosk/tickets/:id/cancel` | تابلت الباب |
| GET · POST | `/chair/barbers` · `/chair/login` `{ barber_id, pin }` · `/chair/logout` | تابلت الكرسي |
| GET · POST | `/chair/queue` · `/chair/stream` · `/chair/next` · `/chair/finish` · `/chair/services` · `/chair/status` | الحلاق اللي داخل |
| POST · GET | `/chair/photo?ticket_id=` (صورة قصّة خام) · `/chair/photos/:id` | اللي على الكرسي أو اللي خلص من أقل من نص ساعة، وليه كارت |

### عام (من غير حساب)
| | المسار | |
|---|---|---|
| GET | `/public/shops/:slug` · `/public/shops/:slug/stream` | صفحة المحل (من غير أي بيانات زباين) |
| GET | `/public/push-key` | المفتاح العام للإشعارات |

## الـ streams (SSE)

- بتتفتح بـ `fetch` (مش `EventSource`) عشان التوكن يروح في ترويسة مش في الرابط.
- كل حدث `event: queue` وفيه الصورة كاملة بـ `version`. أوّل حدث على طول، وبعدها مع كل تغيير (والتغييرات الكتير ورا بعض بتتجمّع في حدث واحد بعد 100ms).
- نبضة كل 25 ثانية، والاتصال بيتقفل لما توكن الدخول يخلص (الواجهة بتفتح واحد جديد). شاشات الأجهزة بتتقفل كل 10 دقايق عشان إلغاء الجهاز يوصل.
- لو الاتصال وقع: `GET …?since=<version>` كل 3 ثواني لحد ما يرجع.

## حدود الطلبات
عام 600 طلب في الدقيقة، والدخول 20 كل ربع ساعة، واستعادة كلمة السر 8 في الساعة، وأخد الدور والـ check-in والـ PIN ليهم حدود أقل (`server/src/middleware/rateLimiters.js`).
