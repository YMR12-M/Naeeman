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
| GET | `/me/tickets` (السجل) · `/me/tickets/active` · `/me/tickets/:id` | |
| POST | `/me/tickets` `{ shop_slug, service_ids, barber_id? }` | خُد دور |
| POST | `/me/tickets/:id/coming` · `/delay` · `/cancel` · `/check-in` `{ code }` | |
| GET | `/me/stream` (SSE) | الدور الشغّال لايف |

### الأجهزة
| | المسار | |
|---|---|---|
| POST | `/devices/pair` `{ code }` | من غير توكن ← توكن الجهاز |
| GET | `/display/queue` · `/display/stream` | التلفزيون |
| GET · POST | `/kiosk/options` · `/kiosk/tickets` · `/kiosk/tickets/:id/cancel` | تابلت الباب |
| GET · POST | `/chair/barbers` · `/chair/login` `{ barber_id, pin }` · `/chair/logout` | تابلت الكرسي |
| GET · POST | `/chair/queue` · `/chair/stream` · `/chair/next` · `/chair/finish` · `/chair/services` · `/chair/status` | الحلاق اللي داخل |

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
