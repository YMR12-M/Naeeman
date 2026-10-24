/**
 * السجل (المالك بس): مين غيّر إيه وإمتى — الأسعار، والفريق، والإعدادات،
 * وتحريك الطابور بإيد. حركة الأدوار العادية ليها تاريخها جوّه كل دور.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { Button, Empty, Loading } from '../components/ui/index.js';
import PageHead from '../components/layout/PageHead.jsx';

const ACTIONS = {
  'auth.login': 'دخل اللوحة',
  'auth.password_changed': 'غيّر كلمة المرور',
  'shop.update': 'عدّل بيانات المحل',
  'shop.hours': 'عدّل المواعيد',
  'shop.settings': 'عدّل قواعد الطابور',
  'service.create': 'ضاف خدمة',
  'service.bulk_create': 'ضاف خدمات',
  'service.update': 'عدّل خدمة',
  'service.archive': 'أرشف خدمة',
  'service.restore': 'رجّع خدمة',
  'barber.create': 'ضاف حلاق',
  'barber.update': 'عدّل حلاق',
  'barber.pin': 'غيّر PIN حلاق',
  'barber.archive': 'شال حلاق',
  'barber.restore': 'رجّع حلاق',
  'user.create': 'ضاف موظف',
  'user.update': 'عدّل موظف',
  'user.delete': 'حذف موظف',
  'user.temp_password': 'طلّع كلمة مؤقتة',
  'device.pairing_code': 'طلّع كود ربط جهاز',
  'device.revoke': 'لغى جهاز',
  'queue.move': 'حرّك دور في الطابور',
  'customer.recovery_code': 'طلّع كود استعادة لزبون',
};

function describe(row) {
  const after = typeof row.after_json === 'string' ? JSON.parse(row.after_json) : row.after_json;
  const before = typeof row.before_json === 'string' ? JSON.parse(row.before_json) : row.before_json;
  const subject = after?.name ?? before?.name ?? after?.full_name ?? before?.full_name;
  if (row.action === 'service.update' && before && after && before.price !== after.price) {
    return `${subject}: السعر من ${before.price / 100} لـ ${after.price / 100} ج`;
  }
  if (row.action === 'queue.move' && after?.reason) return `السبب: ${after.reason}`;
  return subject ?? '';
}

export default function Audit() {
  useDocumentTitle('السجل');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['audit', page], queryFn: () => api.page('/audit', { page, page_size: 30 }) });

  if (!list.data) return <Loading />;
  const { rows, meta } = list.data;
  return (
    <div className="stack lg">
      <PageHead title="السجل" />
      {rows.length === 0 ? <Empty icon="shield" title="السجل فاضي" /> : (
        <div className="panel">
          <div className="panel-body flush table-wrap">
            <table className="table">
              <thead><tr><th>إمتى</th><th>مين</th><th>عمل إيه</th><th>التفاصيل</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="small nowrap">{formatDateTime(row.created_at)}</td>
                    <td>{row.user_name ?? <span className="muted">—</span>}</td>
                    <td>{ACTIONS[row.action] ?? row.action}</td>
                    <td className="small muted">{describe(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {meta.total_pages > 1 && (
        <div className="row end">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>الأحدث</Button>
          <span className="small muted"><span className="num">{page}</span> من <span className="num">{meta.total_pages}</span></span>
          <Button size="sm" disabled={page >= meta.total_pages} onClick={() => setPage(page + 1)}>الأقدم</Button>
        </div>
      )}
    </div>
  );
}
