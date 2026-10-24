/**
 * ═══════════════════════════════════════════════════════════════
 *  الإشعارات (Web Push) والتثبيت على الشاشة الرئيسية
 *
 *  • على الآيفون الإشعارات ما بتشتغلش غير لو التطبيق متثبّت على الشاشة
 *    الرئيسية (iOS 16.4+). عشان كده بنسأل الأوّل: متثبّت؟ ولو لأ بنقول
 *    للزبون إزاي يثبّته قبل ما نطلب الإذن.
 *  • الاشتراك بيتبعت للسيرفر (`/me/push-subscriptions`) ومربوط بالزبون،
 *    فالإشعار بيوصل على أي جهاز اشترك منه.
 * ═══════════════════════════════════════════════════════════════
 */
import { api } from './api.js';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

/** 'unsupported' | 'install-first' | 'denied' | 'granted' | 'default' */
export function pushState() {
  if (isIos() && !isStandalone()) return 'install-first';
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return Promise.resolve(null);
  return navigator.serviceWorker.register('/sw.js').catch(() => null);
}

function keyToBytes(base64) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/**
 * يطلب الإذن ويشترك. بيرجّع الحالة الجديدة.
 * لازم يتنادى من ضغطة زرار (المتصفّحات بترفض الطلب من غير تفاعل).
 */
export async function enablePush() {
  const state = pushState();
  if (state === 'install-first' || state === 'unsupported' || state === 'denied') return state;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;

  const { public_key: publicKey } = await api.public('/public/push-key');
  if (!publicKey) return 'unsupported';
  const registration = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  const json = subscription.toJSON();
  await api.post('/me/push-subscriptions', { endpoint: json.endpoint, keys: json.keys });
  return 'granted';
}

/** لو الإذن موجود من قبل: نجدّد الاشتراك بهدوء (بعد الدخول على جهاز جديد مثلًا) */
export async function refreshPushSubscription() {
  if (pushState() !== 'granted') return;
  try { await enablePush(); } catch { /* مش مهم دلوقتي */ }
}
