/**
 * ═══════════════════════════════════════════════════════════════
 *  الطابور لايف (Server-Sent Events عن طريق fetch)
 *
 *  EventSource ما بيبعتش ترويسات، والتوكن لازم يروح في Authorization أو
 *  X-Device-Token (مش في الرابط عشان ما يتسجّلش في اللوجات)، فبنقرا الـ
 *  stream بإيدنا.
 *
 *  • أوّل ما يفتح: السيرفر بيبعت الصورة كاملة، وبعد كل تغيير صورة جديدة.
 *  • لو اتقفل (نت، أو التوكن خلص وجه حدث reauth): نعيد الفتح بعد مهلة
 *    بتكبر (1 ← 2 ← 5 ← 10 ثواني)، وفي الوقت ده بنسأل `poll()` كل 3 ثواني
 *    عشان الشاشة ما تقفش.
 * ═══════════════════════════════════════════════════════════════
 */
import { API_BASE } from './api.js';

const BACKOFF = [1000, 2000, 5000, 10_000];
const POLL_MS = 3000;

/** يفصل نصّ الـ stream لأحداث { event, data } */
export function parseEvents(buffer) {
  const events = [];
  let rest = buffer;
  let index = rest.indexOf('\n\n');
  while (index !== -1) {
    const chunk = rest.slice(0, index);
    rest = rest.slice(index + 2);
    let event = 'message';
    const data = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0) events.push({ event, data: data.join('\n') });
    index = rest.indexOf('\n\n');
  }
  return { events, rest };
}

/**
 * @param {string}   path
 * @param {object}   options
 * @param {() => Promise<object|null>} options.headers  الترويسات قبل كل فتح (null = مش متاح دلوقتي)
 * @param {(data) => void} options.onData
 * @param {(status: 'live'|'reconnecting') => void} [options.onStatus]
 * @param {() => Promise<void>} [options.poll]   الاحتياطي وقت الانقطاع
 * @param {(error) => void} [options.onFatal]    401/403: الجلسة أو الجهاز مش صالحين
 * @returns {() => void} قفل نهائي
 */
export function openStream(path, { headers, onData, onStatus = () => {}, poll, onFatal = () => {} }) {
  let stopped = false;
  let controller = null;
  let attempt = 0;
  let pollTimer = null;
  let retryTimer = null;

  const startPolling = () => {
    if (!poll || pollTimer) return;
    pollTimer = setInterval(() => { poll().catch(() => {}); }, POLL_MS);
  };
  const stopPolling = () => { clearInterval(pollTimer); pollTimer = null; };

  const scheduleReconnect = () => {
    if (stopped) return;
    onStatus('reconnecting');
    startPolling();
    retryTimer = setTimeout(connect, BACKOFF[Math.min(attempt, BACKOFF.length - 1)]);
    attempt += 1;
  };

  async function connect() {
    if (stopped) return;
    const head = await headers().catch(() => null);
    if (stopped) return;
    if (!head) { scheduleReconnect(); return; }

    controller = new AbortController();
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'text/event-stream', ...head }, signal: controller.signal });
    } catch {
      scheduleReconnect();
      return;
    }
    if (response.status === 401 || response.status === 403) {
      const payload = await response.json().catch(() => null);
      onFatal({ status: response.status, code: payload?.code });
      // الجلسة ممكن تتجدّد (توكن موظف خلص): نحاول تاني بعد مهلة
      scheduleReconnect();
      return;
    }
    if (!response.ok || !response.body) { scheduleReconnect(); return; }

    attempt = 0;
    stopPolling();
    onStatus('live');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- قراية stream بالترتيب
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseEvents(buffer);
        buffer = parsed.rest;
        for (const item of parsed.events) {
          if (item.event === 'queue') {
            try { onData(JSON.parse(item.data)); } catch { /* حدث ناقص: نستنّى اللي بعده */ }
          }
        }
      }
    } catch { /* اتقفل */ }
    if (!stopped) scheduleReconnect();
  }

  connect();
  return () => {
    stopped = true;
    controller?.abort();
    stopPolling();
    clearTimeout(retryTimer);
  };
}
