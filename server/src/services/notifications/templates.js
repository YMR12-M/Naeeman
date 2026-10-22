/**
 * قوالب الرسائل. كل قالب دالة (payload) ← { subject, html, text }.
 * الرسائل عربية RTL بتصميم بسيط يعمل في كل عملاء البريد (جداول + CSS مضمَّن).
 * ألوان «صالون زمان»: رأس الرسالة يافطة خضرا غامقة بكلام كريمي، والزرار جلد نبيتي.
 */
import { env } from '../../config/env.js';

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// عملاء البريد يحجبون خطوط الويب (الرقعة وReadex غير متاحين فيها)، فنستعمل خطّ الجهاز نفسه.
const FONT = "'Segoe UI','Geeza Pro',Tahoma,'Helvetica Neue',Arial,sans-serif";
const INK = '#143C38';
const CREAM = '#F3EBDD';
const LEATHER = '#8E1F1B';
const WALL = '#A9D6C4';

function layout({ title, body, button, footer }) {
  const brand = esc(env.brand.name);
  const buttonHtml = button
    ? `<p style="margin:28px 0"><a href="${esc(button.url)}" style="background:${LEATHER};color:${CREAM};text-decoration:none;padding:12px 26px;border-radius:10px;display:inline-block;font-weight:700">${esc(button.label)}</a></p>`
    : '';
  return `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:${WALL};font-family:${FONT};color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#F4F3EC;border-radius:6px;overflow:hidden">
<tr><td style="background:${INK};color:${CREAM};padding:14px 28px;font-size:26px;font-weight:800;text-align:center">${brand}</td></tr>
<tr><td style="padding:28px;line-height:1.9;font-size:15px"><h2 style="margin:0 0 14px;font-size:21px;font-weight:800">${esc(title)}</h2>${body}${buttonHtml}</td></tr>
<tr><td style="padding:16px 28px;border-top:3px solid ${INK};color:#46605B;font-size:12px">${footer ?? `رسالة تلقائية من ${brand}.`}</td></tr>
</table></td></tr></table></body></html>`;
}

export const templates = {
  password_reset: ({ name, link }) => ({
    subject: `استعادة كلمة المرور — ${env.brand.name}`,
    html: layout({
      title: 'استعادة كلمة المرور',
      body: `<p>أهلًا ${esc(name)}،</p><p>وصلنا طلب لتغيير كلمة مرور حسابك. الرابط صالح لمدّة ساعة واحدة.</p><p>لو مش إنت اللي طلبت، تجاهل الرسالة وحسابك آمن.</p>`,
      button: { url: link, label: 'تغيير كلمة المرور' },
    }),
    text: `أهلًا ${name}\nلتغيير كلمة المرور افتح الرابط (صالح لساعة):\n${link}\nلو مش إنت اللي طلبت تجاهل الرسالة.`,
  }),

  // الدعوة برابط تعيين كلمة المرور (لا كلمة مرور في البريد) — الرابط صالح 3 أيام
  staff_invite: ({ name, email, link, role, shopName }) => ({
    subject: `دعوة للانضمام إلى ${shopName} على ${env.brand.name}`,
    html: layout({
      title: 'تم إنشاء حسابك',
      body: `<p>أهلًا ${esc(name)}،</p><p>تم إنشاء حساب لك في <b>${esc(shopName)}</b> بصلاحية <b>${esc(role)}</b>.</p>
<p>البريد: <b dir="ltr">${esc(email)}</b></p>
<p>اضغط الزرار لتحديد كلمة المرور وبدء الاستخدام. الرابط صالح لمدّة 3 أيام.</p>`,
      button: { url: link, label: 'تحديد كلمة المرور' },
    }),
    text: `أهلًا ${name}\nتم إنشاء حساب لك في ${shopName} (${role}) بالبريد ${email}.\nحدّد كلمة المرور من الرابط (صالح 3 أيام):\n${link}`,
  }),

  customer_password_reset: ({ name, link }) => ({
    subject: `استعادة كلمة السر — ${env.brand.name}`,
    html: layout({
      title: 'استعادة كلمة السر',
      body: `<p>أهلًا ${esc(name)}،</p><p>وصلنا طلب لتغيير كلمة سر حسابك في ${esc(env.brand.name)}. الرابط صالح لمدّة ساعة واحدة.</p><p>لو مش إنت اللي طلبت، تجاهل الرسالة وحسابك آمن.</p>`,
      button: { url: link, label: 'تغيير كلمة السر' },
    }),
    text: `أهلًا ${name}\nلتغيير كلمة السر افتح الرابط (صالح لساعة):\n${link}\nلو مش إنت اللي طلبت تجاهل الرسالة.`,
  }),
};

export function renderTemplate(name, payload) {
  const template = templates[name];
  if (!template) throw new Error(`قالب غير معروف: ${name}`);
  return template(payload);
}
