/**
 * إرسال البريد عبر SMTP (nodemailer).
 *
 *  • SMTP مضبوط   ← إرسال فعلي.
 *  • غير مضبوط في التطوير ← تُطبع الرسالة في اللوج (تقدر تنسخ رابط الاستعادة منه).
 *  • MAIL_DISABLED=true   ← تُتخطّى الرسائل بصمت (مثلاً محل لا يستعمل البريد).
 */
import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

let transporter = null;

function getTransporter() {
  transporter ??= nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.secure,
    auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
  });
  return transporter;
}

export const mailEnabled = () => !env.mail.disabled && Boolean(env.mail.host);

/** @returns {Promise<{status:'sent'|'logged'|'skipped'}>} */
export async function sendMail({ to, subject, html, text }) {
  if (env.mail.disabled) return { status: 'skipped' };

  if (!env.mail.host) {
    logger.info(`[بريد — وضع التطوير] إلى: ${to}\n   الموضوع: ${subject}\n   ${String(text).split('\n').join('\n   ')}`);
    return { status: 'logged' };
  }

  await getTransporter().sendMail({ from: env.mail.from, to, subject, html, text });
  return { status: 'sent' };
}
