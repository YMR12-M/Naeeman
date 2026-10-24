/** تنبيه داخل الصفحة، وتحميل، وحالة فاضية */
import { Icon } from '../../lib/icons.jsx';

export function Notice({ tone = 'info', icon, children, className = '' }) {
  const toneClass = { danger: 'danger', info: 'info', success: 'ok', warn: '' }[tone] ?? '';
  return (
    <div className={`banner ${toneClass} ${className}`.trim()} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon && <Icon name={icon} size={18} />}
      <div className="grow">{children}</div>
    </div>
  );
}

export function Loading({ label = 'ثانية واحدة…' }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ icon = 'inbox', title, children, action }) {
  return (
    <div className="empty">
      <Icon name={icon} size={30} />
      {title && <strong>{title}</strong>}
      {children && <p className="small">{children}</p>}
      {action}
    </div>
  );
}
