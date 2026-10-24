/**
 * ═══════════════════════════════════════════════════════════════
 *  service worker تطبيق الزبون
 *
 *  • الإشعارات: السيرفر بيبعت { title, body, url, tag }. بنعرضها، ولما
 *    الزبون يدوس بنفتح «دوري» (أو نرجّع تبويب التطبيق المفتوح ونوديه هناك).
 *    نفس الـ tag بيستبدل الإشعار القديم بدل ما يتراكموا.
 *  • من غير نت: الصفحة الرئيسية وملفات البناء بتتخزّن أوّل ما تتحمّل،
 *    فالتطبيق بيفتح ويقول «النت فاصل» بدل صفحة المتصفّح البيضا.
 *    طلبات الـ API عمرها ما بتتخزّن: الطابور لازم يبقى طازة.
 * ═══════════════════════════════════════════════════════════════
 */
const CACHE = 'naeeman-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // التنقّل بين الصفحات: النت الأوّل، ولو فاصل الصفحة الرئيسية المتخزّنة (التطبيق بيتعامل مع الرابط)
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  // ملفات البناء أساميها فيها بصمة: اللي اتخزّن مرّة صالح على طول
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() }; }
  const title = payload.title || 'نعيمًا';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || '',
    tag: payload.tag,
    renotify: Boolean(payload.tag),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    data: { url: payload.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  // الرابط ممكن يكون على دومين التطبيق في الإنتاج؛ بنفتح نفس المسار عندنا
  const path = `${target.pathname}${target.search}`;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      open.postMessage({ type: 'navigate', path });
      return;
    }
    await self.clients.openWindow(path);
  })());
});
