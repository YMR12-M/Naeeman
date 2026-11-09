/**
 * تقفيل اليوم (Z): ملخّص كل اللي حصل من آخر تقفيل — المبيعات، والمحصّل لكل
 * طريقة، والدرج والعجز، والحلاقين — وبعدين «قفّل» بيختم الفترة ويطبع التقرير.
 */
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Icon } from '../lib/icons.jsx';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format.js';
import { dayCloseHtml, printHtml } from '../lib/receipt.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Empty, Input, Loading, Modal, Notice, useConfirm } from '../components/ui/index.js';
import { LeatherButton, Mirror, TicketNumber } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';

function Line({ label, value, strong = false, danger = false }) {
  return (
    <div className={`price-row ledger-line ${strong ? 'bold' : ''} ${danger ? 'danger-text' : ''}`.trim()}>
      <span>{label}</span>
      <span className="leader" aria-hidden="true" />
      <span className="price num">{value}</span>
    </div>
  );
}

/** الملخّص نفسه (المعاينة والتقفيل القديم) */
export function CloseSummary({ summary }) {
  const m = summary.movements;
  return (
    <div className="today">
      <Mirror arch className="revenue">
        <span className="muted">المبيعات</span>
        <TicketNumber value={formatNumber(summary.sales / 100)} size="3rem" />
        <span className="muted">جنيه من <span className="num">{summary.bills}</span> فاتورة</span>
      </Mirror>

      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">المبيعات</h2></div>
        <div className="panel-body stack sm">
          <Line label="الخدمات" value={formatMoney(summary.services_sales)} />
          <Line label="المنتجات" value={formatMoney(summary.products_sales)} />
          {summary.discounts > 0 && <Line label="الخصومات" value={formatMoney(summary.discounts, { sign: '−' })} />}
          {summary.rewards > 0 && <Line label={`مكافآت الأختام (${summary.rewards_count})`} value={formatMoney(summary.rewards, { sign: '−' })} />}
          {summary.tips > 0 && <Line label="البقشيش" value={formatMoney(summary.tips)} />}
          {summary.refunds > 0 && <Line label="المرتجع" value={formatMoney(summary.refunds, { sign: '−' })} danger />}
          {summary.products_cost > 0 && <Line label="تكلفة المنتجات" value={formatMoney(summary.products_cost)} />}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">المحصّل</h2></div>
        <div className="panel-body stack sm">
          {summary.methods.length === 0 ? <p className="small muted">مفيش دفعات.</p>
            : summary.methods.map((method) => <Line key={method.code} label={method.label} value={formatMoney(method.net)} />)}
          <Line label="الإجمالي" value={formatMoney(summary.collected)} strong />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">الدرج</h2></div>
        <div className="panel-body stack sm">
          {summary.drawers.map((drawer) => (
            <Line key={drawer.id} label={`وردية ${formatDateTime(drawer.opened_at)}`}
              value={drawer.variance === null ? 'مفتوحة' : drawer.variance === 0 ? 'مظبوطة' : `${drawer.variance < 0 ? 'عجز' : 'زيادة'} ${formatMoney(Math.abs(drawer.variance))}`} />
          ))}
          {m.expense > 0 && <Line label="مصروفات" value={formatMoney(m.expense, { sign: '−' })} />}
          {m.advance > 0 && <Line label="سُلف" value={formatMoney(m.advance, { sign: '−' })} />}
          {m.payout > 0 && <Line label="صرف حسابات" value={formatMoney(m.payout, { sign: '−' })} />}
          {m.cash_in > 0 && <Line label="إيداع" value={formatMoney(m.cash_in)} />}
          {m.cash_out > 0 && <Line label="سحب للخزنة" value={formatMoney(m.cash_out, { sign: '−' })} />}
          <Line label={summary.variance < 0 ? 'العجز كله' : 'الزيادة كلها'} value={formatMoney(Math.abs(summary.variance))} strong danger={summary.variance < 0} />
        </div>
      </section>

      {summary.barbers.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">الحلاقين</h2></div>
          <div className="panel-body stack sm">
            {summary.barbers.map((barber) => (
              <Line key={barber.id} label={<>أ. {barber.name} <span className="small muted">(<span className="num">{barber.customers}</span> زبون{barber.tips ? ` · بقشيش ${formatMoney(barber.tips)}` : ''})</span></>}
                value={formatMoney(barber.services + barber.products)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function HistoryModal({ id, shopName, onClose }) {
  const toast = useToast();
  const close = useQuery({ queryKey: ['day-close', id], queryFn: () => api.get(`/day-close/${id}`) });
  const shop = useQuery({ queryKey: ['shop'], queryFn: () => api.get('/shop') });
  async function print() {
    try { await printHtml(dayCloseHtml(close.data, { shopName, width: shop.data?.settings.receipt_width }), { width: shop.data?.settings.receipt_width }); } catch (error) { toast.error(error.message); }
  }
  return (
    <Modal open onClose={onClose} size="wide" title={close.data ? `تقفيل رقم ${close.data.number}` : 'التقفيل'}
      footer={<><Button icon="print" onClick={print} disabled={!close.data}>اطبع</Button><Button onClick={onClose}>رجوع</Button></>}>
      {!close.data ? <Loading /> : (
        <div className="stack">
          <p className="small muted">{formatDateTime(close.data.period_start)} ← {formatDateTime(close.data.period_end)}{close.data.closed_by_name && ` · ${close.data.closed_by_name}`}{close.data.note && ` · ${close.data.note}`}</p>
          <CloseSummary summary={close.data.summary} />
        </div>
      )}
    </Modal>
  );
}

export default function DayClose() {
  useDocumentTitle('تقفيل اليوم');
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const preview = useQuery({ queryKey: ['day-close', 'preview'], queryFn: () => api.get('/day-close/preview'), refetchInterval: 30_000 });
  const history = useQuery({ queryKey: ['day-close', 'list'], queryFn: () => api.get('/day-close') });
  const shop = useQuery({ queryKey: ['shop'], queryFn: () => api.get('/shop') });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const shopName = user.shop.name;

  async function closeDay() {
    const answer = await confirm({
      title: 'تقفيل اليوم؟', message: 'كل اللي حصل من آخر تقفيل هيتقفل في تقرير واحد، وبعدها الحساب بيبدأ من جديد. التقرير مش بيتعدّل.',
      confirmLabel: 'قفّل اليوم',
    });
    if (!answer) return;
    setBusy(true);
    try {
      const close = await api.act('/day-close', { note: note.trim() || undefined });
      toast.success(`اتقفل — تقفيل رقم ${close.number}`);
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['day-close'] });
      const width = shop.data?.settings.receipt_width ?? 80;
      printHtml(dayCloseHtml(close, { shopName, width }), { width }).catch((error) => toast.error(error.message));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  const data = preview.data;
  return (
    <div className="stack lg">
      <PageHead title="تقفيل اليوم" note={data && <span className="muted">{formatDate(data.business_date)}</span>} />

      {!data ? <Loading /> : (
        <>
          {data.blockers.map((blocker) => (
            <Notice key={blocker.code} tone={blocker.code === 'DRAWER_OPEN' ? 'warn' : 'info'} icon={blocker.code === 'DRAWER_OPEN' ? 'lock' : 'info'}>
              {blocker.message}{blocker.code === 'DRAWER_OPEN' && <> — <NavLink to="/cashier">روح للكاشير</NavLink></>}
            </Notice>
          ))}
          {data.warnings.map((warning) => <Notice key={warning.code} icon="alert">{warning.message}</Notice>)}
          <p className="small muted">من {formatDateTime(data.summary.period_start)} لحد دلوقتي</p>
          <CloseSummary summary={data.summary} />
          <div className="row wrap">
            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="ملاحظة على التقفيل (اختياري)" maxLength={190} style={{ maxWidth: 380 }} aria-label="ملاحظة" />
            <LeatherButton loading={busy} disabled={data.blockers.length > 0} onClick={closeDay}><Icon name="lock" size={18} />قفّل اليوم</LeatherButton>
          </div>
        </>
      )}

      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">التقفيلات اللي فاتت</h2></div>
        <div className="panel-body">
          {!history.data ? <Loading /> : history.data.length === 0 ? <Empty icon="receipt">لسه ما اتقفلش يوم.</Empty> : (
            <ul className="bill-list">
              {history.data.map((close) => (
                <li key={close.id}>
                  <button type="button" className="bill-row" onClick={() => setViewing(close.id)}>
                    <TicketNumber value={close.number} size="1.6rem" />
                    <span className="grow">
                      <span className="bold">{formatDate(close.business_date)}</span>
                      <span className="small muted block"><span className="num">{close.bills}</span> فاتورة{close.closed_by_name && ` · ${close.closed_by_name}`}</span>
                    </span>
                    {close.variance !== 0 && <span className={`badge ${close.variance < 0 ? 'warn' : ''}`}>{close.variance < 0 ? 'عجز' : 'زيادة'} {formatMoney(Math.abs(close.variance))}</span>}
                    <span className="num bold">{formatMoney(close.sales)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {viewing && <HistoryModal id={viewing} shopName={shopName} onClose={() => setViewing(null)} />}
    </div>
  );
}
