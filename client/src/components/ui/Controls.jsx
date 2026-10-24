/**
 * عناصر الإدخال: زر، حقل، قائمة، مفتاح، مبلغ...
 * كل حقل يقبل `error` (نصّ) ويعرضه تحته ويضبط aria-invalid.
 */
import { forwardRef, useEffect, useId, useState } from 'react';
import { inputToMinor, minorToInput } from '../../lib/format.js';
import { Icon } from '../../lib/icons.jsx';

export const Button = forwardRef(function Button(
  { variant = 'secondary', size, icon, loading = false, block = false, children, className = '', type = 'button', ...rest },
  ref,
) {
  const classes = ['btn', variant, size, block && 'block', icon && !children && 'icon', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={classes} disabled={rest.disabled || loading} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
    </button>
  );
});

/** غلاف حقل: تسمية + تلميح + خطأ، ويربط htmlFor تلقائيًّا */
export function Field({ label, hint, error, required, children, className = '' }) {
  const id = useId();
  const control = typeof children === 'function' ? children({ id, 'aria-invalid': Boolean(error) || undefined, 'aria-describedby': error ? `${id}-err` : undefined }) : children;
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={id}>{label}{required && <span className="req" aria-hidden="true">*</span>}</label>}
      {control}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error" id={`${id}-err`} role="alert">{error}</span>}
    </div>
  );
}

export const Input = forwardRef(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`input ${className}`} {...rest} />;
});

export const Textarea = forwardRef(function Textarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`textarea ${className}`} {...rest} />;
});

export const Select = forwardRef(function Select({ className = '', children, ...rest }, ref) {
  return <select ref={ref} className={`select ${className}`} {...rest}>{children}</select>;
});

export function Checkbox({ label, className = '', ...rest }) {
  return (
    <label className={`check ${className}`}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="row" style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span className="switch">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

/**
 * حقل مبلغ: يعرض بالجنيه ويُرجع قروشًا صحيحة (أو null لو فارغ/غير صالح).
 * يحتفظ بنصّه أثناء الكتابة كي لا يمسح «12.» قبل أن تكمل «12.5».
 */
export function MoneyInput({ value, onChange, currency = 'ج.م', ...rest }) {
  const [text, setText] = useState(minorToInput(value));
  useEffect(() => {
    if (inputToMinor(text) !== (value ?? null)) setText(minorToInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- نزامن فقط عند تغيّر القيمة من الخارج
  }, [value]);

  return (
    <div className="input-group">
      <input
        className="input ltr-input"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(event) => { setText(event.target.value); onChange(inputToMinor(event.target.value)); }}
        {...rest}
      />
      <span className="addon">{currency}</span>
    </div>
  );
}

/** نسبة مئوية ⇄ basis points (14 ← 1400) */
export function PercentInput({ value, onChange, ...rest }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value / 100));
  useEffect(() => {
    const parsed = text === '' ? null : Math.round(Number(text) * 100);
    if (parsed !== (value ?? null)) setText(value === null || value === undefined ? '' : String(value / 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="input-group">
      <input
        className="input ltr-input"
        inputMode="decimal"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const number = Number(event.target.value);
          onChange(event.target.value === '' || !Number.isFinite(number) ? null : Math.round(number * 100));
        }}
        {...rest}
      />
      <span className="addon">%</span>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'بحث…', ...rest }) {
  return (
    <div style={{ position: 'relative' }}>
      <Icon name="search" size={18} style={{ position: 'absolute', insetInlineStart: 12, top: 12, color: 'var(--text-faint)' }} />
      <input
        className="input"
        style={{ paddingInlineStart: 38 }}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
    </div>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** عدّاد أرقام صغير (+/−) للبالغين والأطفال */
export function Stepper({ value, onChange, min = 0, max = 99, label }) {
  return (
    <div className="row" role="group" aria-label={label} style={{ gap: 6 }}>
      <Button size="sm" icon="minus" aria-label="أقل" disabled={value <= min} onClick={() => onChange(value - 1)} />
      <span className="num bold" style={{ minWidth: 28, textAlign: 'center' }}>{value}</span>
      <Button size="sm" icon="plus" aria-label="أكثر" disabled={value >= max} onClick={() => onChange(value + 1)} />
    </div>
  );
}
