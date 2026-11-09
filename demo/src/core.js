/* ============================================
   النسخة التجريبية (عرض فقط) - النواة

   بتعترض طلبات fetch لمسار الـ API وبترد عليها من بيانات وهمية متخزنة في
   localStorage عند الزائر نفسه. مفيش سيرفر ولا قاعدة بيانات: كل زائر معاه
   نسخته الخاصة، ومفيش أي حاجة بتتبعت لأي مكان.

   الفرق عن نسخ المشاريع التانية:
   • كل التطبيقات على نفس الدومين (لوحة المحل وتطبيق الزبون)، فبيشوفوا نفس
     البيانات: دور من التطبيق في تبويب بيظهر في اللوحة في تبويب تاني لايف.
   • قبل كل طلب بنقرا البيانات من التخزين من جديد (تبويب تاني ممكن يكون غيّرها)،
     وبعد كل تعديل بنبلّغ الـ streams المفتوحة، وحدث `storage` بيبلّغ التبويبات التانية.
   • ردود الـ stream (Server-Sent Events) بتتعمل بـ ReadableStream، والصور بـ Blob.

   الملف ده مش بيتحمّل في النسخة الحقيقية خالص - بيتحط في index.html بتاع
   النسخة التجريبية بس (demo/build.mjs). ومفيش أي تعديل على كود التطبيقات.
   ============================================ */

// Safari وFirefox القدام ما عندهمش captureStackTrace (ApiError بتاع السيرفر بيستعمله)
if (typeof Error.captureStackTrace !== 'function') Error.captureStackTrace = function () {};

const pad = (n) => String(n).padStart(2, '0');

export const H = {
  pad,
  now: () => Date.now(),
  iso: (ms) => new Date(ms === undefined ? Date.now() : ms).toISOString(),
  // رقم ثابت 0..999 من نص: عشان البيانات المتولّدة تبقى متكررة مش عشوائية
  hash(str) {
    let h = 2166136261;
    str = String(str);
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 1000;
  },
  code(length, alphabet) {
    alphabet = alphabet || 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < length; i += 1) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    return out;
  },
  digits: (length) => H.code(length, '0123456789'),
  uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      return (c === 'x' ? r : (r % 4) + 8).toString(16);
    });
  },
  seq(db, kind) {
    db.seq = db.seq || {};
    db.seq[kind] = (db.seq[kind] || 0) + 1;
    return db.seq[kind];
  },
  clone: (value) => JSON.parse(JSON.stringify(value)),
};

/* ---------- الردود ---------- */

export const ok = (data, status) => ({ status: status || 200, body: { success: true, data: data === undefined ? null : data } });
export const created = (data) => ok(data, 201);
export const paged = (rows, meta) => ({ status: 200, body: { success: true, data: rows, meta } });
export const noContent = () => ({ status: 204, body: null });
export const pageMeta = (page, size, total) => ({ page, page_size: size, total, total_pages: Math.max(1, Math.ceil(total / size)) });
/** رد ملف (صورة) */
export const file = (blob, type) => ({ status: 200, raw: blob, headers: { 'Content-Type': type || blob.type || 'application/octet-stream' } });
/**
 * رد stream (Server-Sent Events).
 * @param {object} spec
 * @param {() => object} spec.render     الصورة اللي تتبعت
 * @param {string} [spec.event]          اسم الحدث (الافتراضي queue)
 * @param {(view) => any} [spec.versionOf] الصورة بتتبعت لما ده يتغيّر بس (الافتراضي view.version)
 * @param {number} [spec.tickMs]         إعادة حساب دورية حتى من غير تغيير
 * @param {boolean} [spec.once]          حدث واحد والاتصال يتقفل
 */
export const stream = (spec) => ({ status: 200, stream: spec });

/** نفس شكل أخطاء السيرفر: { success:false, message, code, errors } */
export function errorBody(error) {
  return {
    success: false,
    message: error.message,
    code: error.code || null,
    ...(error.details ? { errors: error.details } : {}),
  };
}

/* ---------- النواة ---------- */

export function createDemo(cfg) {
  let db = null;

  function load() {
    try {
      const raw = localStorage.getItem(cfg.key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.__v === cfg.version) return parsed;
      }
    } catch (e) {
      /* التخزين المحلي مقفول - هنكمّل من الذاكرة */
    }
    return null;
  }

  let lastSaved = null;
  function save() {
    try {
      const text = JSON.stringify(db);
      if (text === lastSaved) return;
      localStorage.setItem(cfg.key, text);
      lastSaved = text;
    } catch (e) {
      /* الكوتا خلصت أو التخزين مقفول - الجلسة الحالية شغّالة من الذاكرة */
    }
  }

  function reset() {
    db = { __v: cfg.version, seq: {} };
    cfg.seed(db, H);
    save();
  }

  /** نقرا آخر نسخة (تبويب تاني ممكن يكون غيّرها). لو البيانات قدمت (يوم جديد مثلًا) بنبدأ من جديد. */
  function refreshDb() {
    const fresh = load();
    if (fresh) db = fresh;
    if (!db || (cfg.stale && cfg.stale(db, H))) reset();
  }
  refreshDb();

  /* ---------- الـ streams المفتوحة ---------- */

  const subscribers = new Set();
  let notifyTimer = null;
  function notify() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      subscribers.forEach((sub) => sub.push());
    }, 80);
  }

  // تبويب تاني (أو التطبيق التاني على نفس الدومين) غيّر البيانات
  window.addEventListener('storage', (e) => {
    if (e.key !== cfg.key) return;
    const fresh = load();
    if (fresh) {
      db = fresh;
      notify();
    }
  });

  const encoder = new TextEncoder();
  function openStream(spec, signal) {
    let controller = null;
    let closed = false;
    let last;
    let ticker = null;
    const sub = { push };

    function cleanup() {
      closed = true;
      subscribers.delete(sub);
      clearInterval(ticker);
    }
    function close() {
      if (closed) return;
      cleanup();
      try { controller.close(); } catch (e) { /* اتقفل */ }
    }
    function send(event, data, id) {
      if (closed) return;
      try {
        controller.enqueue(encoder.encode(`event: ${event}\n${id !== undefined ? `id: ${id}\n` : ''}data: ${JSON.stringify(data)}\n\n`));
      } catch (e) {
        cleanup();
      }
    }
    function push() {
      if (closed) return;
      let view;
      try {
        refreshDb();
        view = spec.render(db);
      } catch (e) {
        // الحاجة اللي الـ stream بيتابعها مبقتش موجودة: نقفل والواجهة تعيد الفتح وتشوف
        close();
        return;
      }
      const version = JSON.stringify(spec.versionOf ? spec.versionOf(view) : (view && view.version !== undefined ? view.version : view));
      if (version === last) return;
      last = version;
      send(spec.event || 'queue', view, view && view.version !== undefined ? view.version : undefined);
      if (spec.once) close();
    }

    const body = new ReadableStream({
      start(c) {
        controller = c;
        c.enqueue(encoder.encode('retry: 3000\n\n'));
        subscribers.add(sub);
        if (spec.tickMs) ticker = setInterval(push, spec.tickMs);
        setTimeout(push, 0);
      },
      cancel() {
        cleanup();
      },
    });
    if (signal) {
      if (signal.aborted) cleanup();
      else signal.addEventListener('abort', () => {
        cleanup();
        try { controller.error(new DOMException('Aborted', 'AbortError')); } catch (e) { /* اتقفل */ }
      });
    }
    return body;
  }

  /* ---------- اعتراض fetch ---------- */

  const prefixes = [].concat(cfg.prefix);
  const realFetch = window.fetch.bind(window);

  function matchPrefix(pathname) {
    for (let i = 0; i < prefixes.length; i += 1) {
      const p = prefixes[i];
      if (pathname === p || pathname.indexOf(p + '/') === 0) return pathname.slice(p.length) || '/';
    }
    return null;
  }

  function headerValue(headers, name) {
    if (!headers) return undefined;
    if (typeof headers.get === 'function') return headers.get(name) || undefined;
    const lower = name.toLowerCase();
    for (const k in headers) if (k.toLowerCase() === lower) return headers[k];
    return undefined;
  }

  function readBlob(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  function respond(result, signal) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, result.headers || {});
    if (result.stream) {
      headers['Content-Type'] = 'text/event-stream; charset=utf-8';
      return new Response(openStream(result.stream, signal), { status: 200, headers });
    }
    let payload;
    if (result.status === 204) payload = null;
    else if (result.raw !== undefined) payload = result.raw;
    else payload = JSON.stringify(result.body);
    return new Response(payload, { status: result.status, headers });
  }

  async function dispatch(input, init, path, parsed) {
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const headers = (init && init.headers) || (input && input.headers) || {};
    const signal = (init && init.signal) || (input && input.signal) || null;
    let body = null;
    let upload = null;
    const rawBody = init && init.body;
    if (typeof rawBody === 'string' && rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch (e) {
        body = null;
      }
    } else if (rawBody && typeof Blob !== 'undefined' && rawBody instanceof Blob) {
      // رفع ملف خام (صورة): بيتخزّن data URL
      upload = { type: rawBody.type || headerValue(headers, 'Content-Type') || 'application/octet-stream', size: rawBody.size, dataUrl: await readBlob(rawBody) };
    } else if (rawBody && typeof FormData !== 'undefined' && rawBody instanceof FormData) {
      body = {};
      const files = [];
      rawBody.forEach((value, key) => {
        if (typeof Blob !== 'undefined' && value instanceof Blob) files.push({ key, value });
        else body[key] = value;
      });
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        body[f.key] = { type: f.value.type, size: f.value.size, name: f.value.name, dataUrl: await readBlob(f.value) };
      }
    }
    const query = {};
    parsed.searchParams.forEach((v, k) => {
      query[k] = v;
    });

    let result;
    refreshDb();
    try {
      result = cfg.handle({
        method, path, query, body, upload, headers,
        header: (n) => headerValue(headers, n),
      }, db, H);
      if (!result) result = { status: 404, body: { success: false, message: 'المسار ده مش موجود في النسخة التجريبية', code: 'NOT_FOUND' } };
    } catch (e) {
      if (e && (e.statusCode || e.status)) {
        result = { status: e.statusCode || e.status, body: errorBody(e) };
      } else {
        if (window.console) console.error('[demo]', method, path, e);
        result = { status: 500, body: { success: false, message: 'حصل خطأ في النسخة التجريبية', code: 'DEMO_ERROR' } };
      }
    }
    save();
    if (method !== 'GET') notify();

    if (result.stream) return respond(result, signal);
    await new Promise((resolve) => { setTimeout(resolve, 40 + Math.floor(Math.random() * 80)); });
    return respond(result, signal);
  }

  window.fetch = function (input, init) {
    const raw = typeof input === 'string' ? input : input && (input.url || input.href);
    let parsed;
    try {
      parsed = new URL(raw, window.location.origin);
    } catch (e) {
      return realFetch(input, init);
    }
    const path = parsed.origin === window.location.origin ? matchPrefix(parsed.pathname) : null;
    if (path === null) return realFetch(input, init);
    return dispatch(input, init, path, parsed);
  };

  /* ---------- شريط التجربة ---------- */

  const API = {
    db: () => db,
    H,
    save,
    notify,
    refresh: refreshDb,
    reset() {
      try {
        localStorage.removeItem(cfg.key);
      } catch (e) {
        /* لا شيء */
      }
      reset();
      if (cfg.onReset) cfg.onReset(API);
      window.location.href = cfg.home || '/';
    },
    go(url) {
      save();
      notify();
      window.location.href = url || cfg.home || '/';
    },
    open(url) {
      save();
      notify();
      window.open(url, '_blank', 'noopener');
    },
    /** تعديل على البيانات من الشريط نفسه (زي «قدّم الطابور») */
    mutate(fn) {
      refreshDb();
      const out = fn(db, H);
      save();
      notify();
      return out;
    },
  };

  function mountBar() {
    if (document.getElementById('demo-bar')) return;
    const bar = typeof cfg.bar === 'function' ? cfg.bar(API) : cfg.bar || {};
    if (bar.hidden) return;
    const style = document.createElement('style');
    style.textContent =
      '#demo-bar{position:fixed;left:10px;bottom:10px;z-index:2147483000;font-family:inherit;direction:rtl;font-size:13px;line-height:1.5}' +
      '#demo-bar *{box-sizing:border-box}' +
      '#demo-toggle{display:flex;align-items:center;gap:6px;background:#1c1c24;color:#fff;border:1px solid rgba(255,255,255,.28);' +
      'border-radius:999px;padding:7px 13px;font:inherit;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.35)}' +
      '#demo-toggle i{width:8px;height:8px;border-radius:50%;background:#f5b93a;display:inline-block}' +
      '#demo-panel{display:none;position:absolute;left:0;bottom:calc(100% + 8px);width:min(300px,calc(100vw - 20px));max-height:min(78vh,620px);overflow:auto;' +
      'background:#fff;color:#1c1c24;border:1px solid #d6d6dc;border-radius:14px;padding:12px;box-shadow:0 12px 32px rgba(0,0,0,.3)}' +
      '#demo-panel p{margin:0 0 8px;font-size:12.5px;color:#454552}' +
      '#demo-panel h4{margin:12px 0 2px;font-size:12px;color:#6a6a78;font-weight:700}' +
      '#demo-panel button{display:block;width:100%;margin-top:6px;padding:9px 11px;border-radius:10px;border:1px solid #1c1c24;' +
      'background:#fff;color:#1c1c24;font:inherit;font-weight:700;text-align:right;cursor:pointer}' +
      '#demo-panel button.primary{background:#1c1c24;color:#fff}' +
      '#demo-panel small{display:block;margin-top:9px;font-size:11.5px;color:#6a6a78}' +
      '#demo-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);background:#1c1c24;color:#fff;padding:8px 14px;border-radius:10px;' +
      'font:inherit;font-size:13px;z-index:2147483001;direction:rtl;box-shadow:0 6px 18px rgba(0,0,0,.3);max-width:calc(100vw - 24px)}' +
      // قواعد إضافية خاصة بكل تطبيق (رفع الزرار فوق شريط سفلي مثلًا)
      (bar.css || '');
    document.head.appendChild(style);

    const actions = bar.actions || [];
    const wrap = document.createElement('div');
    wrap.id = 'demo-bar';
    const items = actions
      .map((a, i) => (a.section ? '<h4 data-h="' + i + '"></h4>' : '<button type="button" class="' + (a.primary ? 'primary' : '') + '" data-i="' + i + '"></button>'))
      .join('');
    wrap.innerHTML =
      '<div id="demo-panel" role="dialog" aria-label="خيارات النسخة التجريبية">' +
      '<p></p>' + items +
      '<h4>البيانات</h4><button type="button" data-reset="1">إعادة ضبط البيانات</button><small></small></div>' +
      '<button id="demo-toggle" type="button" aria-expanded="false" aria-controls="demo-panel"><i></i><span></span></button>';
    (bar.mountOnRoot ? document.documentElement : document.body).appendChild(wrap);

    const panel = wrap.querySelector('#demo-panel');
    const toggle = wrap.querySelector('#demo-toggle');
    toggle.querySelector('span').textContent = bar.label || 'نسخة تجريبية';
    panel.querySelector('p').textContent = bar.intro || 'ده عرض للتطبيق ببيانات وهمية متخزنة على جهازك بس.';
    panel.querySelector('small').textContent = bar.note || '';
    actions.forEach((a, i) => {
      const el = panel.querySelector(a.section ? 'h4[data-h="' + i + '"]' : 'button[data-i="' + i + '"]');
      if (el) el.textContent = a.section || a.label;
    });

    function setOpen(open) {
      panel.style.display = open ? 'block' : 'none';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    toggle.addEventListener('click', () => {
      setOpen(panel.style.display !== 'block');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.style.display === 'block') setOpen(false);
    });
    panel.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.getAttribute('data-reset')) {
        API.reset();
        return;
      }
      const idx = t.getAttribute('data-i');
      if (idx !== null && actions[Number(idx)]) {
        const message = actions[Number(idx)].run(API);
        if (typeof message === 'string') toast(message);
      }
    });
    if (bar.openFirst && !sessionStorage.getItem(cfg.key + ':seen')) {
      try {
        sessionStorage.setItem(cfg.key + ':seen', '1');
      } catch (e) {
        /* لا شيء */
      }
      setOpen(true);
    }
  }

  let toastTimer = null;
  function toast(text) {
    let el = document.getElementById('demo-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.display = 'none';
    }, 3200);
  }
  API.toast = toast;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBar);
  else mountBar();

  return API;
}
