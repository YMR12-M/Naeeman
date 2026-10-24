import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Icon } from '../lib/icons.jsx';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);

  const push = useCallback((kind, message, { duration = 4500 } = {}) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((list) => [...list.slice(-3), { id, kind, message }]);
    if (duration > 0) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (message, options) => push('success', message, options),
    error: (message, options) => push('error', message, { duration: 7000, ...options }),
    info: (message, options) => push('info', message, options),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-live="polite" aria-label="إشعارات">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
            <Icon name={toast.kind === 'error' ? 'alert' : toast.kind === 'success' ? 'check' : 'info'} size={18} />
            <div className="grow">{toast.message}</div>
            <button type="button" className="btn ghost icon sm" style={{ color: 'inherit' }} onClick={() => dismiss(toast.id)} aria-label="إغلاق">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast خارج ToastProvider');
  return context;
};
