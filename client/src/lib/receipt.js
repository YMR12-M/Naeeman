/**
 * ═══════════════════════════════════════════════════════════════
 *  الإيصال وتقرير التقفيل للطباعة
 *
 *  صفحة HTML مستقلّة بمقاس طابعة الإيصالات (58 أو 80 مم). خطوط النظام
 *  (Tahoma/Arial) عشان الطباعة تشتغل من غير نت ومن غير تحميل خطوط.
 *
 *  الطباعة:
 *   • برنامج الكمبيوتر: على طابعة الإيصالات اللي اتختارت، من غير نافذة
 *     (`naeemanDesktop.printHtml`).
 *   • المتصفّح: iframe مخفي ونافذة الطباعة العادية.
 * ═══════════════════════════════════════════════════════════════
 */

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

/** قروش ← «120» أو «120.50» (من غير «ج»: العمود عنوانه بالعملة) */
export function money(minor) {
  const pounds = Number(minor || 0) / 100;
  const text = Number.isInteger(pounds) ? String(pounds) : pounds.toFixed(2);
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const dateTime = (value) => {
  if (!value) return '';
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
};

function page(width, body) {
  const paper = Number(width) === 58 ? 48 : 72; // المساحة اللي بتتطبع فعلًا
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>إيصال</title>
<style>
@page { size: ${Number(width) === 58 ? 58 : 80}mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: ${paper}mm; margin: 0 auto; padding: 3mm 0 6mm; font: 12px/1.45 Tahoma, "Segoe UI", Arial, sans-serif; }
h1 { font-size: 17px; margin: 0; text-align: center; }
.c { text-align: center; } .s { font-size: 10.5px; } .b { font-weight: 700; }
.n { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
table { width: 100%; border-collapse: collapse; }
td { padding: 0.6mm 0; vertical-align: top; }
td.v { text-align: left; white-space: nowrap; padding-inline-start: 2mm; }
tr.t td { font-size: 15px; font-weight: 700; padding-top: 1.5mm; }
.stamps { letter-spacing: 1px; font-size: 14px; }
</style></head><body>${body}</body></html>`;
}

const row = (label, value, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="v n">${value}</td></tr>`;

/** إيصال فاتورة: data = رد GET /bills/:id/receipt */
export function receiptHtml(data, { copy = false } = {}) {
  const { shop, bill } = data;
  const place = [shop.address, shop.city].filter(Boolean).join('، ');
  const items = bill.items.map((item) => row(
    `${esc(item.name)}${item.qty > 1 ? ` <span class="n">× ${item.qty}</span>` : ''}${item.barber_name && item.kind === 'service' ? `<div class="s">أ. ${esc(item.barber_name)}</div>` : ''}`,
    money(item.line_total),
  )).join('');
  const payments = (bill.payments ?? []).filter((payment) => payment.kind === 'payment')
    .map((payment) => row(esc(payment.method_label), money(payment.amount))).join('');
  const refunds = (bill.payments ?? []).filter((payment) => payment.kind === 'refund')
    .map((payment) => row(`مرتجع (${esc(payment.method_label)})`, `-${money(-payment.amount)}`)).join('');
  const loyalty = bill.card?.loyalty;
  const stamps = loyalty?.enabled
    ? `<hr><div class="c"><div class="stamps">${'●'.repeat(Math.min(loyalty.stamps, loyalty.required))}${'○'.repeat(Math.max(0, loyalty.required - loyalty.stamps))}</div>
       <div class="s">${loyalty.eligible ? `الزيارة الجاية: ${esc(loyalty.reward)}` : `فاضلّك <span class="n">${loyalty.left}</span> وتاخد ${esc(loyalty.reward)}`}</div></div>`
    : '';

  return page(data.width, `
<h1>${esc(shop.name)}</h1>
${place ? `<div class="c s">${esc(place)}</div>` : ''}
${shop.phone ? `<div class="c s n">${esc(shop.phone)}</div>` : ''}
<hr>
<table>
${row('فاتورة', `#${bill.number}`)}
${row('التاريخ', dateTime(bill.paid_at || bill.created_at))}
${bill.customer_name ? row('الزبون', esc(bill.customer_name)) : ''}
${bill.ticket ? row('الدور', `#${bill.ticket.number}`) : ''}
</table>
<hr>
<table>${items}</table>
<hr>
<table>
${row('المجموع', money(bill.subtotal))}
${bill.discount ? row(`خصم${bill.discount_reason ? ` (${esc(bill.discount_reason)})` : ''}`, `-${money(bill.discount)}`) : ''}
${bill.reward_discount ? row('مكافأة الأختام', `-${money(bill.reward_discount)}`) : ''}
${row('الإجمالي (ج)', money(bill.total), 't')}
${bill.tip ? row('بقشيش', money(bill.tip)) : ''}
</table>
${payments || refunds ? `<hr><table>${payments}${bill.change_given ? row('الباقي', money(bill.change_given)) : ''}${refunds}</table>` : ''}
${bill.status === 'open' ? '<hr><div class="c b">لسه ما اتدفعتش</div>' : ''}
${stamps}
<hr>
<div class="c">${esc(data.footer || 'نعيمًا')}</div>
${shop.url ? `<div class="c s n">${esc(shop.url.replace(/^https?:\/\//, ''))}</div>` : ''}
${copy ? '<div class="c s">نسخة</div>' : ''}`);
}

/** تقرير تقفيل اليوم (Z) على نفس الطابعة */
export function dayCloseHtml(close, { shopName, width = 80 }) {
  const sum = close.summary;
  const methods = sum.methods.map((method) => row(esc(method.label), money(method.net))).join('');
  const barbers = sum.barbers.map((barber) => row(
    `أ. ${esc(barber.name)} <span class="s n">(${barber.customers})</span>`,
    money(barber.services + barber.products),
  )).join('');
  const m = sum.movements;
  return page(width, `
<h1>${esc(shopName)}</h1>
<div class="c b">تقفيل رقم <span class="n">${close.number}</span></div>
<div class="c s">${dateTime(close.period_start)} ← ${dateTime(close.period_end)}</div>
<hr>
<table>
${row('الفواتير', sum.bills)}
${row('الخدمات', money(sum.services_sales))}
${row('المنتجات', money(sum.products_sales))}
${sum.discounts ? row('الخصومات', `-${money(sum.discounts)}`) : ''}
${sum.rewards ? row('مكافآت الأختام', `-${money(sum.rewards)}`) : ''}
${row('المبيعات (ج)', money(sum.sales), 't')}
${sum.tips ? row('البقشيش', money(sum.tips)) : ''}
${sum.refunds ? row('المرتجع', `-${money(sum.refunds)}`) : ''}
</table>
<hr><div class="b">المحصّل</div>
<table>${methods}${row('الإجمالي', money(sum.collected), 't')}</table>
<hr><div class="b">الدرج</div>
<table>
${m.expense ? row('مصروفات', `-${money(m.expense)}`) : ''}
${m.advance ? row('سُلف', `-${money(m.advance)}`) : ''}
${m.payout ? row('صرف حسابات', `-${money(m.payout)}`) : ''}
${m.cash_in ? row('إيداع', money(m.cash_in)) : ''}
${m.cash_out ? row('سحب للخزنة', `-${money(m.cash_out)}`) : ''}
${row(sum.variance < 0 ? 'عجز' : 'زيادة', money(Math.abs(sum.variance)), 'b')}
</table>
${barbers ? `<hr><div class="b">الحلاقين</div><table>${barbers}</table>` : ''}
${sum.open_bills?.count ? `<hr><div class="c s">فيه <span class="n">${sum.open_bills.count}</span> فاتورة مفتوحة اترحّلت</div>` : ''}
<hr><div class="c s">${esc(close.closed_by_name || '')}</div>`);
}

/** يطبع صفحة HTML: على طابعة الإيصالات في برنامج الكمبيوتر، أو نافذة الطباعة في المتصفّح */
export async function printHtml(html, { width = 80 } = {}) {
  const bridge = typeof window !== 'undefined' ? window.naeemanDesktop : null;
  if (bridge?.printHtml) {
    const result = await bridge.printHtml(html, { widthMm: Number(width) });
    if (result?.ok === false) throw new Error(result.message || 'الطباعة ما اشتغلتش');
    return;
  }
  await new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    frame.onload = () => {
      const view = frame.contentWindow;
      const done = () => { setTimeout(() => frame.remove(), 500); resolve(); };
      view.addEventListener('afterprint', done, { once: true });
      view.focus();
      view.print();
      setTimeout(done, 60_000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
