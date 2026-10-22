/**
 * ═══════════════════════════════════════════════════════════════
 *  Server-Sent Events للطابور
 *
 *  الشاشة بتفتح اتصال واحد، والسيرفر يبعت صورة الطابور أوّل ما يفتح
 *  وبعد كل تغيير. الأفعال نفسها (التالي، وصل…) بتروح REST عادي.
 *
 *  • الاتصال بيتقفل لوحده لما توكن الدخول يخلص، والواجهة تفتح واحد جديد
 *    بتوكن جديد (فإيقاف الحساب بيسري خلال دقايق حتى على الشاشات المفتوحة).
 *  • نبضة كل 25 ثانية عشان البروكسيات ما تقفلش الاتصال.
 *  • لو تغييرات كتير ورا بعض، بنبعت صورة واحدة بعدها بـ 100ms.
 *  • `Cache-Control: no-transform` بيخلّي compression يعدّي الـ stream من غير ضغط.
 *
 *  المتصفّح: EventSource ما بيبعتش ترويسات، فالواجهة بتستعمل fetch + قارئ
 *  stream (التوكن في Authorization، مش في الرابط عشان ما يتسجّلش في اللوجات).
 * ═══════════════════════════════════════════════════════════════
 */
import { subscribeQueue } from './bus.js';
import { logger } from '../utils/logger.js';

const HEARTBEAT_MS = 25_000;
const DEBOUNCE_MS = 100;

/**
 * @param {object}   req, res
 * @param {object}   options
 * @param {number}   options.shopId
 * @param {Function} options.render     () => Promise<object>  الصورة اللي تتبعت (لازم فيها version)
 * @param {number}   [options.expiresAt] لحظة انتهاء التوكن (ms)
 */
export function openQueueStream(req, res, { shopId, render, expiresAt }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  let closed = false;
  let timer = null;
  let lastVersion = null;

  const send = async () => {
    timer = null;
    if (closed) return;
    try {
      const view = await render();
      if (closed || view.version === lastVersion) return;
      lastVersion = view.version;
      res.write(`event: queue\nid: ${view.version}\ndata: ${JSON.stringify(view)}\n\n`);
    } catch (error) {
      logger.warn(`تعذّر إرسال صورة الطابور (محل ${shopId}): ${error.message}`);
    }
  };

  const schedule = () => {
    if (!timer) timer = setTimeout(send, DEBOUNCE_MS);
  };

  const unsubscribe = subscribeQueue(shopId, schedule);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  const expiry = expiresAt
    ? setTimeout(() => {
      res.write('event: reauth\ndata: {}\n\n');
      res.end();
    }, Math.max(0, expiresAt - Date.now()))
    : null;

  const cleanup = () => {
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    clearTimeout(timer);
    clearTimeout(expiry);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);

  send();
}
