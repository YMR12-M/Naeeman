/**
 * إشارة «الطابور اتغيّر» داخل نفس عملية السيرفر.
 *
 * بعد ما أي تعديل على الطابور يتسجّل (commit)، بنبعت رقم النسخة الجديد،
 * وكل شاشة فاتحة stream للمحل ده بتعيد حساب الصورة وتبعتها.
 *
 * لو شغّلت أكتر من نسخة من السيرفر، النسخة التانية مش هتسمع الإشارة:
 * الشاشات وقتها بترجع للاحتياطي (تسأل `?since=` كل كام ثانية) لحد ما
 * نحطّ Redis pub/sub هنا. الواجهة نفسها مش هتتغيّر.
 */
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
// كل شاشة مفتوحة = مستمع. محل فيه تلفزيون وكشك و6 كراسي ولوحتين و50 زبون فاتح التطبيق
bus.setMaxListeners(0);

const channel = (shopId) => `shop:${shopId}`;

export function publishQueue(shopId, version) {
  bus.emit(channel(shopId), version);
}

/** @returns {() => void} دالة لإلغاء الاشتراك */
export function subscribeQueue(shopId, listener) {
  bus.on(channel(shopId), listener);
  return () => bus.off(channel(shopId), listener);
}
