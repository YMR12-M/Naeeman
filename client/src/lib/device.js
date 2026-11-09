/**
 * ═══════════════════════════════════════════════════════════════
 *  عميل الأجهزة (التلفزيون، والكشك، والكرسي)
 *
 *  الجهاز ما بيدخلش بحساب شخص: بيتربط مرّة بكود من 6 أرقام وياخد توكن
 *  طويل بيتحفظ في الجهاز نفسه (localStorage، لكل نوع جهاز مفتاح لوحده،
 *  فنفس المتصفّح ينفع يبقى كشك وتلفزيون للتجربة). لو المالك لغى الجهاز،
 *  التوكن بيتمسح ويرجع لشاشة الربط.
 * ═══════════════════════════════════════════════════════════════
 */
import { API_BASE, ApiRequestError, newKey } from './api.js';

const storageKey = (type) => `naeeman.device.${type}`;

export function readDevice(type) {
  try {
    const raw = window.localStorage.getItem(storageKey(type));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDevice(type, value) {
  try {
    if (value) window.localStorage.setItem(storageKey(type), JSON.stringify(value));
    else window.localStorage.removeItem(storageKey(type));
  } catch { /* وضع خاص: الربط يفضل للجلسة دي بس */ }
}

export const forgetDevice = (type) => saveDevice(type, null);

/** الكود اللي المالك طلّعه ← الجهاز اتربط */
export async function pairDevice(type, code) {
  const response = await fetch(`${API_BASE}/devices/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }).catch(() => null);
  if (!response) throw new ApiRequestError('تعذّر الاتصال بالخادم — تأكد من الإنترنت', { offline: true });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(payload?.message || 'الكود غلط', { status: response.status, code: payload?.code, errors: payload?.errors });
  }
  const { token, device } = payload.data;
  if (device.type !== type) {
    throw new ApiRequestError(`الكود ده لـ «${device.name}» مش للشاشة دي — اطلب كود من النوع الصح`, { code: 'WRONG_DEVICE_TYPE' });
  }
  saveDevice(type, { token, device });
  return device;
}

/** طلب بتوكن الجهاز. `key` لأفعال الطابور (منع التكرار). */
export async function deviceRequest(type, path, { method = 'GET', body, key } = {}) {
  const stored = readDevice(type);
  if (!stored) throw new ApiRequestError('الجهاز مش مربوط', { status: 401, code: 'NO_DEVICE_TOKEN' });
  const headers = { Accept: 'application/json', 'X-Device-Token': stored.token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiRequestError('النت فاصل — بنحاول تاني', { offline: true });
  }
  const payload = await response.json().catch(() => null);
  if (response.ok) return payload?.data ?? null;
  if (response.status === 401 && ['DEVICE_REVOKED', 'NO_DEVICE_TOKEN'].includes(payload?.code)) forgetDevice(type);
  throw new ApiRequestError(payload?.message || 'حصل خطأ غير متوقّع', { status: response.status, code: payload?.code, errors: payload?.errors });
}

/** فعل من الجهاز: مفتاح منع تكرار + محاولة تانية بنفس المفتاح لو النت قطع */
export async function deviceAct(type, path, body = {}) {
  const key = newKey();
  try {
    return await deviceRequest(type, path, { method: 'POST', body, key });
  } catch (error) {
    if (!error.offline) throw error;
    await new Promise((resolve) => { setTimeout(resolve, 800); });
    return deviceRequest(type, path, { method: 'POST', body, key });
  }
}

/** صورة من السيرفر بتوكن الجهاز (الصور مش في مكان عام) */
export async function deviceBlob(type, path) {
  const stored = readDevice(type);
  if (!stored) throw new ApiRequestError('الجهاز مش مربوط', { status: 401, code: 'NO_DEVICE_TOKEN' });
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { headers: { Accept: '*/*', 'X-Device-Token': stored.token } });
  } catch {
    throw new ApiRequestError('النت فاصل — بنحاول تاني', { offline: true });
  }
  if (!response.ok) throw new ApiRequestError('الصورة مش موجودة', { status: response.status });
  return response.blob();
}

/** رفع ملف خام (صورة قصّة) بتوكن الجهاز. `params` بتروح في الرابط. */
export async function deviceUpload(type, path, file, params = {}) {
  const stored = readDevice(type);
  if (!stored) throw new ApiRequestError('الجهاز مش مربوط', { status: 401, code: 'NO_DEVICE_TOKEN' });
  const query = new URLSearchParams(params).toString();
  let response;
  try {
    response = await fetch(`${API_BASE}${path}${query ? `?${query}` : ''}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Device-Token': stored.token,
        'Content-Type': file.type || 'image/jpeg',
        'Idempotency-Key': newKey(),
      },
      body: file,
    });
  } catch {
    throw new ApiRequestError('النت فاصل — جرّب تصوّر تاني', { offline: true });
  }
  const payload = await response.json().catch(() => null);
  if (response.ok) return payload?.data ?? null;
  throw new ApiRequestError(payload?.message || 'الصورة ما اترفعتش', { status: response.status, code: payload?.code, errors: payload?.errors });
}

export const deviceHeaders = (type) => {
  const stored = readDevice(type);
  return stored ? { 'X-Device-Token': stored.token } : null;
};
