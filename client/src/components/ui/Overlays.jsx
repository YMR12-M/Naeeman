import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../lib/icons.jsx';
import { useDismiss, useLatest } from '../../lib/hooks.js';
import { Button, Field, Textarea } from './Controls.jsx';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * نافذة حوار: Esc للإغلاق، تحبس التركيز، وتمنع تمرير الخلفية.
 * `onClose` يُقرأ من مرجع: الصفحة الأم تمرّر دالة جديدة عند كل رسم، ولو كانت ضمن
 * اعتماديات الأثر لقفز التركيز إلى أول حقل مع كل ضغطة مفتاح.
 */
export function Modal({ open, onClose, title, children, footer, size = '', dismissible = true }) {
  const ref = useRef(null);
  const titleId = useId();
  const closeRef = useLatest(onClose);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    document.body.style.overflow = 'hidden';
    const node = ref.current;
    (node?.querySelector('[data-autofocus]') ?? node?.querySelector(FOCUSABLE))?.focus();

    const onKey = (event) => {
      if (event.key === 'Escape' && dismissible) { event.stopPropagation(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open, dismissible, closeRef]);

  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && dismissible) onClose(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {dismissible && <Button variant="ghost" size="sm" icon="close" aria-label="إغلاق" onClick={onClose} />}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** درج جانبي (قائمة التنقّل على الشاشات الصغيرة) */
export function Drawer({ open, onClose, children }) {
  const closeRef = useLatest(onClose);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, closeRef]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">{children}</aside>
    </>,
    document.body,
  );
}

/**
 * قائمة منسدلة بسيطة: <Menu trigger=…> أزرار </Menu>
 * بتترسم في body بمكان ثابت محسوب من الزرار: أعمدة الطابور بتتمرّر لوحدها
 * (overflow)، ولو القايمة جوّاها كانت بتتقصّ وآخر بنودها ما يبانش.
 * ولو مفيش مكان تحت الزرار بتفتح لفوق.
 */
export function Menu({ trigger, children, align = 'end' }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, close, open, menuRef);

  useLayoutEffect(() => {
    if (!open || !ref.current || !menuRef.current) return;
    const anchor = ref.current.getBoundingClientRect();
    const height = menuRef.current.offsetHeight;
    const width = menuRef.current.offsetWidth;
    const gap = 4;
    const below = window.innerHeight - anchor.bottom - gap;
    const top = below >= height || anchor.top < height + gap
      ? Math.min(anchor.bottom + gap, Math.max(gap, window.innerHeight - height - gap))
      : anchor.top - height - gap;
    // «end» في RTL = شمال الزرار
    const rtl = getComputedStyle(ref.current).direction === 'rtl';
    const alignLeft = (align === 'end') === rtl;
    const left = alignLeft ? anchor.left : anchor.right - width;
    setPosition({ top, left: Math.min(Math.max(gap, left), window.innerWidth - width - gap) });
  }, [open, align]);

  useEffect(() => {
    if (!open) return undefined;
    // القايمة ثابتة مكانها: أي تمرير أو تغيير مقاس بيقفلها بدل ما تفضل معلّقة بعيد عن زرارها
    const onMove = (event) => { if (!menuRef.current?.contains(event.target)) close(); };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', close); };
  }, [open, close]);

  return (
    <div className="dropdown" ref={ref}>
      <span onClick={() => { setPosition(null); setOpen((value) => !value); }} role="presentation">{trigger}</span>
      {open && createPortal(
        <div
          className="menu" role="menu" ref={menuRef} onClick={close}
          style={{ position: 'fixed', top: position?.top ?? 0, left: position?.left ?? 0, insetInlineEnd: 'auto', visibility: position ? 'visible' : 'hidden' }}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}
export const MenuItem = ({ icon, children, danger, ...rest }) => (
  <button type="button" role="menuitem" style={danger ? { color: 'var(--danger)' } : undefined} {...rest}>
    {icon && <Icon name={icon} size={16} />}{children}
  </button>
);

/* ── تأكيد وعمليات تحتاج سببًا ── */
const ConfirmContext = createContext(null);

/**
 * const confirm = useConfirm();
 * const answer = await confirm({ title, message, danger, confirmLabel, reason: { label, required } });
 * answer === null لو أُلغي، وإلا { reason }.
 */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const [reason, setReason] = useState('');

  const confirm = useCallback((options) => new Promise((resolve) => {
    setReason('');
    setRequest({ ...options, resolve });
  }), []);

  const close = (result) => { request?.resolve(result); setRequest(null); };
  const needsReason = request?.reason?.required && reason.trim().length < 3;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(request)}
        onClose={() => close(null)}
        title={request?.title ?? ''}
        size="narrow"
        footer={(
          <>
            <Button onClick={() => close(null)}>{request?.cancelLabel ?? 'رجوع'}</Button>
            <Button variant={request?.danger ? 'danger' : 'primary'} disabled={needsReason} onClick={() => close({ reason: reason.trim() })} data-autofocus={!request?.reason || undefined}>
              {request?.confirmLabel ?? 'تأكيد'}
            </Button>
          </>
        )}
      >
        <div className="stack">
          {request?.message && <p className="soft">{request.message}</p>}
          {request?.reason && (
            <Field label={request.reason.label ?? 'السبب'} required={request.reason.required}>
              {(props) => <Textarea {...props} data-autofocus value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />}
            </Field>
          )}
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm خارج ConfirmProvider');
  return confirm;
};
