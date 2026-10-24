/**
 * آخر محل الزبون فتحه (عشان «المحل» في الشريط والرئيسية يرجّعوه له).
 * في localStorage لأنه مجرّد راحة: لو اتمسح، الزبون يمسح الـ QR تاني.
 */
const KEY = 'naeeman.lastShop';

export function lastShop() {
  try { return window.localStorage.getItem(KEY); } catch { return null; }
}

export function rememberShop(slug) {
  try { window.localStorage.setItem(KEY, slug); } catch { /* وضع خاص */ }
}

/**
 * من نص الـ QR (رابط أو كود) ← { slug, code } أو { path } أو null.
 *  • `…/checkin/<slug>?code=123456` ← كود الوصول
 *  • `…/s/<slug>` ← صفحة المحل
 *  • `123456` ← كود الوصول مكتوب
 */
export function readScan(text) {
  const value = String(text ?? '').trim();
  if (/^\d{6}$/.test(value)) return { code: value };
  let url;
  try { url = new URL(value); } catch { return null; }
  const checkin = /^\/checkin\/([a-z0-9-]+)\/?$/.exec(url.pathname);
  if (checkin && /^\d{6}$/.test(url.searchParams.get('code') ?? '')) return { slug: checkin[1], code: url.searchParams.get('code') };
  const shop = /^\/s\/([a-z0-9-]+)\/?$/.exec(url.pathname);
  if (shop) return { path: `/s/${shop[1]}` };
  return null;
}
