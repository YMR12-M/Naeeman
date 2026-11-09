/**
 * ═══════════════════════════════════════════════════════════════
 *  عميل الـ API لتطبيق الزبون
 *
 *  نفس طريقة لوحة المحل (client/src/lib/api.js)، بس على حساب الزبون:
 *  • توكن الدخول في الذاكرة فقط، وتوكن التجديد في كوكي httpOnly على
 *    مسار `/customer-auth` (منفصل تمامًا عن كوكي الموظفين).
 *  • تجديد واحد مشترك مهما تزامنت الطلبات، ومحاولات لو تبويب تاني بيجدّد.
 *  • أفعال الدور (`api.act`) بمفتاح Idempotency-Key: لو النت قطع والطلب
 *    اتعاد، السيرفر بيرجّع نفس الرد من غير ما ينفّذ تاني.
 * ═══════════════════════════════════════════════════════════════
 */
const BASE = import.meta.env.VITE_API_URL || '/api/v1';
const CLIENT_TYPE = 'web';

export class ApiRequestError extends Error {
  constructor(message, { status = 0, code = null, errors = null, offline = false } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.offline = offline;
  }
}

/* ── الجلسة ─────────────────────────────────────────────────── */
let accessToken = null;
let refreshTimer = null;
let refreshing = null;
const expiredListeners = new Set();

export const getAccessToken = () => accessToken;
export const onSessionExpired = (listener) => {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
};

function scheduleRefresh(expiresIn) {
  clearTimeout(refreshTimer);
  const delay = Math.max(15, Math.min(expiresIn - 60, expiresIn * 0.8)) * 1000;
  refreshTimer = setTimeout(() => { refreshSession().catch(() => {}); }, delay);
}

function applySession({ tokens }) {
  accessToken = tokens.access_token;
  scheduleRefresh(tokens.expires_in);
}

export function endSession({ notify = false } = {}) {
  accessToken = null;
  clearTimeout(refreshTimer);
  if (notify) expiredListeners.forEach((listener) => listener());
}

/** يجدّد الجلسة من الكوكي. يعيد { customer, tokens } أو null. */
export function refreshSession() {
  refreshing ??= (async () => {
    try {
      const post = () => fetch(`${BASE}/customer-auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Client-Type': CLIENT_TYPE },
        body: '{}',
      });
      let response = await post();
      let payload = await response.json().catch(() => null);
      // تبويب تاني بيجدّد في نفس اللحظة: نستنى رده يوصل والكوكي تتحدّث ونعيد
      for (const wait of [400, 700, 1000, 1400, 2000]) {
        if (!(response.status === 401 && payload?.code === 'REFRESH_IN_PROGRESS')) break;
        // eslint-disable-next-line no-await-in-loop -- محاولات متتالية مقصودة
        await new Promise((resolve) => { setTimeout(resolve, wait); });
        // eslint-disable-next-line no-await-in-loop
        response = await post();
        // eslint-disable-next-line no-await-in-loop
        payload = await response.json().catch(() => null);
      }
      if (!response.ok) { endSession(); return null; }
      applySession(payload.data);
      return payload.data;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** بعد دخول أو تسجيل أو تغيير كلمة سر ناجح */
export const startSession = (data) => applySession(data);

/* ── الطلبات ────────────────────────────────────────────────── */
async function rawRequest(path, { method = 'GET', body, auth = true, retry = true, key, blob = false } = {}) {
  const headers = { Accept: blob ? '*/*' : 'application/json', 'X-Client-Type': CLIENT_TYPE };
  if (key) headers['Idempotency-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError('النت فاصل — اتأكد إنك متصل وجرّب تاني', { offline: true });
  }

  if (response.status === 204) return null;
  if (blob && response.ok) return response.blob();
  const payload = await response.json().catch(() => null);
  if (response.ok) return payload && 'data' in payload ? payload.data : payload;

  if (response.status === 401 && retry && auth && ['TOKEN_EXPIRED', 'NO_TOKEN'].includes(payload?.code)) {
    const session = await refreshSession();
    if (session) return rawRequest(path, { method, body, auth, retry: false, key, blob });
    endSession({ notify: true });
  }

  throw new ApiRequestError(payload?.message || 'حصل خطأ غير متوقّع', {
    status: response.status, code: payload?.code, errors: payload?.errors,
  });
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** فعل على الدور: مفتاح منع تكرار + محاولة تانية بنفس المفتاح لو النت قطع */
async function act(path, body = {}) {
  const key = newKey();
  try {
    return await rawRequest(path, { method: 'POST', body, key });
  } catch (error) {
    if (!(error instanceof ApiRequestError) || !error.offline) throw error;
    await new Promise((resolve) => { setTimeout(resolve, 800); });
    return rawRequest(path, { method: 'POST', body, key });
  }
}

export const api = {
  get: (path) => rawRequest(path),
  /** ملف بتوكن الحساب (صور القصّات مش في مكان عام) */
  blob: (path) => rawRequest(path, { blob: true }),
  /** صفحات عامة من غير حساب */
  public: (path) => rawRequest(path, { auth: false }),
  post: (path, body = {}, options = {}) => rawRequest(path, { method: 'POST', body, ...options }),
  patch: (path, body = {}) => rawRequest(path, { method: 'PATCH', body }),
  del: (path, body) => rawRequest(path, { method: 'DELETE', body }),
  act,
};

export { BASE as API_BASE };
