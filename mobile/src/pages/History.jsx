/** سجلّي: آخر 50 دور، بالمحل والخدمات والحلاق والحساب */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatDate, formatMoney, STATUS_LABELS } from '../lib/format.js';
import { Mirror } from '../components/brand/index.jsx';
import { Empty, Loading, Notice } from '../components/ui/index.js';

const TONE = { done: 'ok', waiting: 'info', serving: 'info', cancelled: '', no_show: 'danger' };

export default function History() {
  useDocumentTitle('سجلّي');
  const history = useQuery({ queryKey: ['history'], queryFn: () => api.get('/me/tickets') });

  if (history.isLoading) return <Loading />;
  if (history.error) return <Notice tone="danger" icon="alert">{history.error.message}</Notice>;
  const rows = history.data ?? [];

  return (
    <div className="stack lg">
      <h1 className="page-title">سجلّي</h1>
      {rows.length === 0 ? (
        <Mirror className="page-card"><Empty icon="list" title="لسه ما خدتش أدوار">أوّل دور هتاخده هيظهر هنا.</Empty></Mirror>
      ) : (
        <ol className="history">
          {rows.map((row) => (
            <li key={row.id}>
              <Link to={`/turn/${row.id}`} className="history-row">
                <span className="ticket-number history-number">{row.number}</span>
                <span className="grow stack sm">
                  <span className="bold">{row.shop_name}</span>
                  <span className="small muted">{row.services}{row.barber_name ? ` · أ. ${row.barber_name}` : ''}</span>
                  <span className="xsmall muted">{formatDate(row.business_date)}</span>
                </span>
                <span className="stack sm end-text">
                  <span className={`badge ${TONE[row.status] ?? ''}`.trim()}>{STATUS_LABELS[row.status]}</span>
                  {row.status === 'done' && <span className="small num">{formatMoney(row.total)}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
