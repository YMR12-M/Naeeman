/**
 * ═══════════════════════════════════════════════════════════════
 *  الكاشير
 *
 *  • الفواتير اللي مستنية الدفع (أدوار خلصت، وبيع منتجات)، بتتحدّث لوحدها.
 *  • «بيع منتج»: فاتورة من غير دور (الماسح بيكتب الباركود ويدوس Enter).
 *  • الدرج: الفكّة، والمحصّل، والمصروف والسُلف، والمفروض يكون كام، وقفله بالعدّ.
 *  • فواتير النهارده اللي اتدفعت: إيصال تاني أو مرتجع.
 * ═══════════════════════════════════════════════════════════════
 */
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Icon } from '../lib/icons.jsx';
import { useDocumentTitle, useNow } from '../lib/hooks.js';
import { formatMoney, formatTime } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Button, Empty, Field, Input, Loading, Modal, MoneyInput, Notice, SearchInput, Segmented, Select,
} from '../components/ui/index.js';
import { LeatherButton, MarkerNote, Mirror, TicketNumber } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';
import BillModal from '../components/shop/BillModal.jsx';

const MOVE_LABELS = { expense: 'مصروف', advance: 'سلفة', payout: 'صرف حساب', cash_in: 'إيداع', cash_out: 'سحب للخزنة' };
const OUT = new Set(['expense', 'advance', 'payout', 'cash_out']);

const minutesAgo = (value, now) => Math.max(0, Math.round((now - new Date(value)) / 60_000));

/* ── حركة على الدرج ── */
function MovementModal({ type, onClose, onDone }) {
  const toast = useToast();
  const barbers = useQuery({ queryKey: ['barbers'], queryFn: () => api.get('/barbers'), enabled: type === 'advance' });
  const [amount, setAmount] = useState(null);
  const [note, setNote] = useState('');
  const [barberId, setBarberId] = useState('');
  const [busy, setBusy] = useState(false);
  const needsNote = type === 'expense' || type === 'cash_out';

  async function save() {
    setBusy(true);
    try {
      onDone(await api.act('/drawer/movements', {
        type, amount, note: note.trim() || undefined, barber_id: type === 'advance' ? Number(barberId) : undefined,
      }));
      toast.success(`${MOVE_LABELS[type]} اتسجّل`);
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={MOVE_LABELS[type]} size="narrow"
      footer={<><Button onClick={onClose}>رجوع</Button><Button variant="primary" loading={busy}
        disabled={!amount || (needsNote && note.trim().length < 2) || (type === 'advance' && !barberId)} onClick={save}>سجّل</Button></>}>
      <div className="stack">
        {type === 'advance' && (
          <Field label="الحلاق" required>
            {(props) => (
              <Select {...props} value={barberId} onChange={(event) => setBarberId(event.target.value)}>
                <option value="">اختار…</option>
                {(barbers.data ?? []).map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="المبلغ" required>
          {(props) => <MoneyInput {...props} currency="ج" value={amount} onChange={setAmount} data-autofocus />}
        </Field>
        <Field label={type === 'expense' ? 'اتصرف على إيه' : 'ملاحظة'} required={needsNote}>
          {(props) => <Input {...props} value={note} onChange={(event) => setNote(event.target.value)} maxLength={190}
            placeholder={type === 'expense' ? 'شاي، منظّفات، شفرات…' : ''} />}
        </Field>
        {type === 'advance' && <p className="small muted">السلفة بتتخصم من حساب الحلاق الجاي.</p>}
      </div>
    </Modal>
  );
}

/* ── قفل الدرج بالعدّ ── */
function CloseDrawerModal({ session, onClose, onDone }) {
  const toast = useToast();
  const [counted, setCounted] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const expected = session.totals.expected_cash;
  const variance = counted === null ? null : counted - expected;

  async function save() {
    setBusy(true);
    try {
      onDone(await api.act('/drawer/close', { counted_cash: counted, note: note.trim() || undefined }));
      toast.success('الدرج اتقفل');
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="اقفل الدرج" size="narrow"
      footer={<><Button onClick={onClose}>رجوع</Button><LeatherButton loading={busy} disabled={counted === null} onClick={save}>اقفل الدرج</LeatherButton></>}>
      <div className="stack">
        <p className="soft">عِدّ الكاش اللي في الدرج واكتبه. السيستم هيقارنه باللي المفروض يكون.</p>
        <Field label="الكاش اللي اتعدّ" required>
          {(props) => <MoneyInput {...props} currency="ج" value={counted} onChange={setCounted} data-autofocus />}
        </Field>
        <div className="row between"><span className="muted">المفروض</span><span className="num bold">{formatMoney(expected)}</span></div>
        {variance !== null && (
          <div className={`row between ${variance === 0 ? '' : variance < 0 ? 'danger-text' : ''}`}>
            <span>{variance === 0 ? 'مظبوط' : variance < 0 ? 'عجز' : 'زيادة'}</span>
            <span className="num bold">{formatMoney(Math.abs(variance))}</span>
          </div>
        )}
        <Field label="ملاحظة">
          {(props) => <Input {...props} value={note} onChange={(event) => setNote(event.target.value)} maxLength={190} />}
        </Field>
      </div>
    </Modal>
  );
}

/* ── لوح الدرج ── */
function DrawerPanel() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const drawer = useQuery({ queryKey: ['drawer', 'current'], queryFn: () => api.get('/drawer/current'), refetchInterval: 20_000 });
  const [float, setFloat] = useState(null);
  const [opening, setOpening] = useState(false);
  const [move, setMove] = useState(null);
  const [closing, setClosing] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['drawer'] });

  async function open() {
    setOpening(true);
    try { await api.act('/drawer/open', { opening_float: float ?? 0 }); refresh(); toast.success('الدرج اتفتح'); } catch (error) { toast.error(error.message); } finally { setOpening(false); }
  }

  if (drawer.isLoading) return <Mirror className="drawer-panel"><Loading /></Mirror>;
  const session = drawer.data;

  if (!session) {
    return (
      <Mirror className="drawer-panel stack">
        <h2 className="panel-title"><Icon name="lock" size={18} /> الدرج مقفول</h2>
        <p className="small muted">افتح الدرج بالفكّة اللي فيه عشان تبدأ تحصّل.</p>
        <Field label="الفكّة">
          {(props) => <MoneyInput {...props} currency="ج" value={float} onChange={setFloat} />}
        </Field>
        <LeatherButton block loading={opening} onClick={open}>افتح الدرج</LeatherButton>
      </Mirror>
    );
  }

  const { totals } = session;
  return (
    <Mirror className="drawer-panel stack">
      <div className="row between">
        <h2 className="panel-title"><Icon name="dollar" size={18} /> الدرج</h2>
        <span className="small muted">من {formatTime(session.opened_at)}{session.opened_by_name && ` · ${session.opened_by_name}`}</span>
      </div>
      <div className="drawer-expected">
        <span className="small muted">المفروض في الدرج</span>
        <TicketNumber value={formatMoney(totals.expected_cash).replace(/[⁧⁩]/g, '')} size="2rem" />
      </div>
      <div className="stack xs small">
        <div className="row between"><span>الفكّة</span><span className="num">{formatMoney(session.opening_float)}</span></div>
        {totals.methods.map((method) => (
          <div key={method.code} className="row between">
            <span>{method.label} <span className="muted">(<span className="num">{method.count}</span>)</span></span>
            <span className="num">{formatMoney(method.net)}</span>
          </div>
        ))}
        {Object.entries(totals.movements).filter(([, amount]) => amount > 0).map(([type, amount]) => (
          <div key={type} className="row between muted">
            <span>{MOVE_LABELS[type]}</span>
            <span className="num">{formatMoney(amount, { sign: OUT.has(type) ? '−' : '+' })}</span>
          </div>
        ))}
      </div>
      <div className="chips">
        {can('drawer.expense') && <button type="button" className="chip" onClick={() => setMove('expense')}><Icon name="minus" size={14} />مصروف</button>}
        {can('drawer.advance') && <button type="button" className="chip" onClick={() => setMove('advance')}><Icon name="user" size={14} />سلفة</button>}
        {can('drawer.expense') && <button type="button" className="chip" onClick={() => setMove('cash_in')}><Icon name="plus" size={14} />إيداع</button>}
        {can('drawer.expense') && <button type="button" className="chip" onClick={() => setMove('cash_out')}><Icon name="lock" size={14} />للخزنة</button>}
      </div>
      {session.movements.length > 0 && (
        <details className="small">
          <summary className="muted">الحركات (<span className="num">{session.movements.length}</span>)</summary>
          <ul className="visit-list">
            {session.movements.map((item) => (
              <li key={item.id}>
                <span className="muted">{formatTime(item.created_at)}</span>
                <span className="grow truncate">{MOVE_LABELS[item.type]}{item.barber_name && ` · ${item.barber_name}`}{item.note && <span className="muted"> · {item.note}</span>}</span>
                <span className="num">{formatMoney(item.amount, { sign: OUT.has(item.type) ? '−' : '+' })}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Button block icon="lock" onClick={() => setClosing(true)}>اقفل الدرج بالعدّ</Button>
      {move && <MovementModal type={move} onClose={() => setMove(null)} onDone={refresh} />}
      {closing && <CloseDrawerModal session={session} onClose={() => setClosing(false)} onDone={refresh} />}
    </Mirror>
  );
}

/* ── سطر فاتورة ── */
function BillRow({ bill, now, onOpen }) {
  return (
    <li>
      <button type="button" className="bill-row" onClick={() => onOpen(bill)}>
        <TicketNumber value={bill.ticket_number ?? bill.number} size="1.7rem" />
        <span className="grow">
          <span className="bold">{bill.customer_name || (bill.source === 'counter' ? 'بيع منتج' : 'زبون')}</span>
          <span className="small muted block">
            {bill.barber_name ? `أ. ${bill.barber_name}` : bill.source === 'counter' ? 'من غير دور' : ''}
            {' · '}<span className="num">{bill.items_count}</span> سطر
            {bill.status === 'open' && <> · من <span className="num">{minutesAgo(bill.created_at, now)}</span> د</>}
            {bill.status === 'paid' && bill.paid_at && <> · {formatTime(bill.paid_at)}</>}
          </span>
        </span>
        {bill.refunded > 0 && <span className="badge warn">مرتجع</span>}
        {bill.auto_paid && <span className="badge">كاش لوحده</span>}
        <span className="num bold">{formatMoney(bill.status === 'open' ? bill.subtotal : bill.total)}</span>
      </button>
    </li>
  );
}

export default function Cashier() {
  useDocumentTitle('الكاشير');
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const now = useNow(30_000);
  const [view, setView] = useState('open');
  const [q, setQ] = useState('');
  const [openBill, setOpenBill] = useState(null);
  const [creating, setCreating] = useState(false);
  const shop = useQuery({ queryKey: ['shop'], queryFn: () => api.get('/shop') });
  const bills = useQuery({
    queryKey: ['bills', view, q],
    queryFn: () => api.page('/bills', view === 'open'
      ? { status: 'open', q: q || undefined, page_size: 100 }
      : { status: view, date: shop.data?.now?.business_date, q: q || undefined, page_size: 100 }),
    refetchInterval: view === 'open' ? 8_000 : 30_000,
    enabled: Boolean(shop.data),
  });

  async function counterSale() {
    setCreating(true);
    try {
      const bill = await api.act('/bills', {});
      queryClient.setQueryData(['bill', bill.id], bill);
      setOpenBill(bill.id);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setCreating(false);
    }
  }

  const rows = bills.data?.rows ?? [];
  return (
    <div className="stack lg">
      <PageHead title="الكاشير">
        <SearchInput value={q} onChange={setQ} placeholder="اسم، موبايل، رقم فاتورة" aria-label="دوّر على فاتورة" />
        <LeatherButton onClick={counterSale} loading={creating}><Icon name="tag" size={18} />بيع منتج</LeatherButton>
      </PageHead>

      {shop.data && !shop.data.settings.cashier_enabled && (
        <Notice icon="info">
          الكاشير مقفول: الدور لما يخلص بيتسدّد كاش لوحده. هنا بتبيع منتجات وتشوف الفواتير.
          {can('shop.write') && <> <NavLink to="/settings">شغّله من الإعدادات</NavLink>.</>}
        </Notice>
      )}

      <div className="cashier">
        <section className="stack">
          <Segmented label="الفواتير" value={view} onChange={setView} options={[
            { value: 'open', label: 'مستنية الدفع' }, { value: 'paid', label: 'اتدفعت النهارده' }, { value: 'void', label: 'ملغية' },
          ]} />
          {!bills.data ? <Loading /> : rows.length === 0 ? (
            <Mirror>
              <Empty icon="receipt" title={view === 'open' ? 'مفيش فواتير مستنية' : 'مفيش فواتير'}>
                {view === 'open' ? 'الدور لما يخلص فاتورته بتظهر هنا لوحدها.' : 'لسه مفيش حاجة النهارده.'}
              </Empty>
            </Mirror>
          ) : (
            <Mirror className="bill-list-wrap">
              {view === 'open' && rows.length > 0 && <MarkerNote flat>{rows.length} مستنيين</MarkerNote>}
              <ul className="bill-list">
                {rows.map((bill) => <BillRow key={bill.id} bill={bill} now={now} onOpen={(row) => setOpenBill(row.id)} />)}
              </ul>
            </Mirror>
          )}
        </section>
        <aside><DrawerPanel /></aside>
      </div>

      {openBill && (
        <BillModal billId={openBill} onClose={() => { setOpenBill(null); queryClient.invalidateQueries({ queryKey: ['bills'] }); }} />
      )}
    </div>
  );
}
