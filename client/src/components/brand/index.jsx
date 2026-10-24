/**
 * ═══════════════════════════════════════════════════════════════
 *  قطع المحل (docs/DESIGN_SYSTEM.md قسم 2)
 *  كل مكوّن هنا حاجة حقيقية في محل الحلاقة. الشكل نفسه في brand.css.
 * ═══════════════════════════════════════════════════════════════
 */
import { useEffect, useRef, useState } from 'react';
import { WORDMARK } from '../../lib/wordmark.js';
import { formatMoney, initial } from '../../lib/format.js';

/** اليافطة المدهونة: لوح غامق، خط دهان داخلي، رقعة، ومسمارين */
export function Sign({ children, size, block = false, as: Tag = 'div', className = '', ...rest }) {
  const classes = ['sign', size, block && 'block', className].filter(Boolean).join(' ');
  return (
    <Tag className={classes} {...rest}>
      <span className="screw start" aria-hidden="true" />
      {children}
      <span className="screw end" aria-hidden="true" />
    </Tag>
  );
}

/** «نعيمًا» كمسار (مش نص): شكله ثابت من غير ما الخط يتحمّل */
export function Wordmark({ height = '1.5em', className = '' }) {
  return (
    <svg className={`wordmark ${className}`.trim()} viewBox={WORDMARK.viewBox} style={{ height }} role="img" aria-label="نعيمًا">
      <path d={WORDMARK.d} />
    </svg>
  );
}

/** المراية بإطار الكروم. `arch` للحاجة الأهم في الشاشة بس (رقم الدور، حلاق على التلفزيون) */
export function Mirror({ arch = false, thin = false, flashKey, as: Tag = 'div', className = '', children, ...rest }) {
  const [flash, setFlash] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (flashKey === undefined) return undefined;
    if (first.current) { first.current = false; return undefined; }
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 950);
    return () => clearTimeout(timer);
  }, [flashKey]);
  const classes = ['mirror', arch && 'arch', thin && 'thin', flash && 'flash', className].filter(Boolean).join(' ');
  return <Tag className={classes} {...rest}>{children}</Tag>;
}

/**
 * كتابة الماركر على المراية: ملاحظة قصيرة (6 كلمات أو أقل).
 * `value` لو اتغيّر، الكلام بيتمسح ويتكتب من جديد.
 */
export function MarkerNote({ children, value, flat = false, ok = false, className = '', as: Tag = 'span', ...rest }) {
  const [round, setRound] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (value === undefined) return;
    if (first.current) { first.current = false; return; }
    setRound((current) => current + 1);
  }, [value]);
  const classes = ['marker', flat && 'flat', ok && 'ok', round > 0 && 'rewrite', className].filter(Boolean).join(' ');
  return <Tag key={round} className={classes} {...rest}>{children}</Tag>;
}

/** زرار الجلد: الفعل الأساسي الوحيد في الشاشة */
export function LeatherButton({ size, block = false, giant = false, loading = false, disabled = false, className = '', type = 'button', children, ...rest }) {
  const classes = ['leather', size, block && 'block', giant && 'giant', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** سطر قايمة الأسعار: الخدمة ........ السعر */
export function PriceRow({ name, price, suffix, className = '', ...rest }) {
  return (
    <div className={`price-row ${className}`.trim()} {...rest}>
      <span>{name}</span>
      <span className="leader" aria-hidden="true" />
      {suffix}
      <span className="price num">{formatMoney(price)}</span>
    </div>
  );
}

/** رقم الدور بخط الرقعة */
export function TicketNumber({ value, size = '2.6rem', className = '' }) {
  return <span className={`ticket-number ${className}`.trim()} style={{ fontSize: size }}>{value}</span>;
}

/** يافطة «مفتوح / مقفول» متعلّقة بخيط */
export function OpenSign({ open, closedLabel = 'مقفول' }) {
  return (
    <span className={`open-sign ${open ? 'open' : ''}`.trim()} role="status">
      <span>{open ? 'مفتوح' : closedLabel}</span>
    </span>
  );
}

/** صورة الحلاق جوّه مراية صغيرة، أو أوّل حرف من اسمه */
export function Portrait({ name, src, large = false }) {
  return (
    <span className={`portrait ${large ? 'lg' : ''}`.trim()} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initial(name)}
    </span>
  );
}
