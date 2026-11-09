/**
 * حساب الحلاقين: طريقة حساب كل حلاق (نسبة، أو يومية، أو إيجار كرسي)، والحساب
 * لحد يوم معيّن بتفصيله، وقفله (يتصرف من الدرج أو برّه). كل اللي اتحسب ما
 * بيتحسبش تاني.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatDate, formatMoney } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Button, Empty, Field, Input, Loading, Modal, MoneyInput, Notice, PercentInput, Segmented, Select, Switch,
} from '../components/ui/index.js';
import { LeatherButton, Mirror, Portrait, TicketNumber } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';

const TYPES = {
  commission: { label: 'بالنسبة', preset: { service_pct: 4000, product_pct: 1000, daily_wage: 0, rent_amount: 0 } },
  salary: { label: 'بيومية', preset: { service_pct: 0, product_pct: 0, daily_wage: 15000, rent_amount: 0 } },
  chair_rent: { label: 'إيجار كرسي', preset: { service_pct: 10000, product_pct: 0, daily_wage: 0, rent_amount: 70000 } },
};
const PERIODS = { day: 'في اليوم', week: 'في الأسبوع', month: 'في الشهر' };
const pct = (bp) => `${bp / 100}%`;

/** «40% خدمات · 10% منتجات · يومية 150 ج» */
function payText(pay) {
  const parts = [];
  if (pay.daily_wage) parts.push(`يومية ${formatMoney(pay.daily_wage)}`);
  if (pay.service_pct) parts.push(pay.service_pct === 10000 ? 'الخدمات كلها ليه' : `${pct(pay.service_pct)} خدمات`);
  if (pay.product_pct) parts.push(`${pct(pay.product_pct)} منتجات`);
  if (pay.rent_amount) parts.push(`إيجار ${formatMoney(pay.rent_amount)} ${PERIODS[pay.rent_period]}`);
  if (!pay.tips_to_barber) parts.push('البقشيش للمحل');
  return parts.length ? parts.join(' · ') : 'لسه ما اتحددتش';
}

function PayModal({ barber, onClose, onDone }) {
  const toast = useToast();
  const [values, setValues] = useState({
    pay_type: barber.pay_type, service_pct: barber.service_pct, product_pct: barber.product_pct, daily_wage: barber.daily_wage,
    rent_amount: barber.rent_amount, rent_period: barber.rent_period, tips_to_barber: barber.tips_to_barber,
  });
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => setValues((current) => ({ ...current, [key]: value }));

  async function save() {
    setBusy(true);
    try {
      await api.put(`/payroll/barbers/${barber.id}`, {
        ...values,
        service_pct: values.service_pct ?? 0, product_pct: values.product_pct ?? 0,
        daily_wage: values.daily_wage ?? 0, rent_amount: values.rent_amount ?? 0,
      });
      toast.success('اتحفظت طريقة الحساب');
      onDone();
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`حساب أ. ${barber.name}`}
      footer={<><Button onClick={onClose}>رجوع</Button><LeatherButton loading={busy} onClick={save}>حفظ</LeatherButton></>}>
      <div className="stack">
        <Segmented label="طريقة الحساب" value={values.pay_type}
          onChange={(type) => setValues((current) => ({ ...current, pay_type: type, ...TYPES[type].preset }))}
          options={Object.entries(TYPES).map(([value, type]) => ({ value, label: type.label }))} />
        <p className="small muted">
          الصافي = اليومية × أيام الشغل + نسبة الخدمات + نسبة المنتجات + البقشيش − الإيجار − السُلف.
          القالب بيحط أرقام مبدئية، وتقدر تغيّرها.
        </p>
        <div className="grid cols-2">
          <Field label="نسبة الخدمات">{(props) => <PercentInput {...props} value={values.service_pct} onChange={set('service_pct')} />}</Field>
          <Field label="نسبة المنتجات">{(props) => <PercentInput {...props} value={values.product_pct} onChange={set('product_pct')} />}</Field>
          <Field label="اليومية">{(props) => <MoneyInput {...props} currency="ج" value={values.daily_wage} onChange={set('daily_wage')} />}</Field>
          <Field label="إيجار الكرسي">{(props) => <MoneyInput {...props} currency="ج" value={values.rent_amount} onChange={set('rent_amount')} />}</Field>
          {Boolean(values.rent_amount) && (
            <Field label="الإيجار">
              {(props) => (
                <Select {...props} value={values.rent_period} onChange={(event) => set('rent_period')(event.target.value)}>
                  {Object.entries(PERIODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              )}
            </Field>
          )}
        </div>
        <Switch checked={values.tips_to_barber} onChange={set('tips_to_barber')} label="البقشيش للحلاق" />
        <p className="small muted">النسبة الجديدة على الفواتير الجاية بس — اللي اتدفع قبل كده فاضل بنسبته القديمة.</p>
      </div>
    </Modal>
  );
}

function Breakdown({ preview }) {
  const line = (label, value, sign = '') => (
    <div className="price-row ledger-line">
      <span>{label}</span><span className="leader" aria-hidden="true" /><span className="price num">{formatMoney(value, { sign })}</span>
    </div>
  );
  return (
    <div className="stack sm">
      <p className="small muted">
        من {formatDate(preview.period_from)} لـ {formatDate(preview.period_to)} · <span className="num">{preview.days_worked}</span> يوم شغل
        · <span className="num">{preview.services_count}</span> خدمة بـ {formatMoney(preview.services_total)}
      </p>
      {preview.wages > 0 && line(`اليومية × ${preview.days_worked}`, preview.wages)}
      {preview.service_commission > 0 && line(`نسبة الخدمات (${pct(preview.pay.service_pct)})`, preview.service_commission)}
      {preview.product_commission > 0 && line(`نسبة المنتجات (${pct(preview.pay.product_pct)} من ${formatMoney(preview.products_total).replace(/[⁧⁩]/g, '')})`, preview.product_commission)}
      {preview.tips > 0 && line('البقشيش', preview.tips)}
      {preview.rent > 0 && line(`الإيجار (${preview.period_days} يوم)`, preview.rent, '−')}
      {preview.advances > 0 && line(`السُلف (${preview.advance_list.length})`, preview.advances, '−')}
    </div>
  );
}

function SettleModal({ barber, preview, onClose, onDone }) {
  const toast = useToast();
  const [via, setVia] = useState('drawer');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.act('/payroll/settlements', { barber_id: barber.id, to: preview.period_to, via, note: note.trim() || undefined });
      toast.success('الحساب اتقفل');
      onDone();
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }
  const owes = preview.net < 0;
  return (
    <Modal open onClose={onClose} title={`اقفل حساب أ. ${barber.name}`} size="narrow"
      footer={<><Button onClick={onClose}>رجوع</Button><LeatherButton loading={busy} onClick={save}>اقفل الحساب</LeatherButton></>}>
      <div className="stack">
        <div className="bill-total">
          <span>{owes ? 'على الحلاق' : 'للحلاق'}</span>
          <TicketNumber value={formatMoney(Math.abs(preview.net)).replace(/[⁧⁩]/g, '')} size="2rem" />
        </div>
        {preview.net !== 0 && (
          <Segmented label="الفلوس" value={via} onChange={setVia} options={[
            { value: 'drawer', label: owes ? 'دفع في الدرج' : 'يتصرف من الدرج' },
            { value: 'outside', label: 'برّه الدرج' },
          ]} />
        )}
        <Field label="ملاحظة">{(props) => <Input {...props} value={note} onChange={(event) => setNote(event.target.value)} maxLength={190} />}</Field>
        <p className="small muted">كل الشغل والسُلف لحد {formatDate(preview.period_to)} هيتقفلوا في الحساب ده.</p>
      </div>
    </Modal>
  );
}

function BarberPay({ barber, onChanged }) {
  const { can } = useAuth();
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState(false);
  const [settling, setSettling] = useState(false);
  const preview = useQuery({
    queryKey: ['payroll', 'preview', barber.id, to],
    queryFn: () => api.get('/payroll/preview', { barber_id: barber.id, to: to || undefined }),
  });
  const data = preview.data;
  const empty = data && data.days_worked === 0 && data.services_count === 0 && data.tips === 0 && data.advances === 0 && data.rent === 0 && data.products_total === 0;

  return (
    <Mirror as="section" className="pay-card stack">
      <header className="row">
        <Portrait name={barber.name} />
        <div className="grow">
          <div className="bold">أ. {barber.name}</div>
          <div className="small muted">{TYPES[barber.pay_type]?.label} · {payText(barber)}</div>
        </div>
        {can('payroll.write') && <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(true)}>الطريقة</Button>}
      </header>
      <label className="row tight small">
        <span className="muted">الحساب لحد</span>
        <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} style={{ width: 160 }} />
      </label>
      {preview.error && <Notice tone="warn" icon="alert">{preview.error.message}</Notice>}
      {!data ? !preview.error && <Loading /> : empty ? (
        <p className="small muted">مفيش حاجة تتحسب{barber.last_settled_to && ` من بعد ${formatDate(barber.last_settled_to)}`}.</p>
      ) : (
        <>
          <Breakdown preview={data} />
          <div className="bill-total">
            <span>{data.net < 0 ? 'على الحلاق' : 'الصافي للحلاق'}</span>
            <TicketNumber value={formatMoney(Math.abs(data.net)).replace(/[⁧⁩]/g, '')} size="1.9rem" />
          </div>
          {can('payroll.write') && <LeatherButton block onClick={() => setSettling(true)}>اقفل الحساب</LeatherButton>}
        </>
      )}
      {editing && <PayModal barber={barber} onClose={() => setEditing(false)} onDone={onChanged} />}
      {settling && data && <SettleModal barber={barber} preview={data} onClose={() => setSettling(false)} onDone={onChanged} />}
    </Mirror>
  );
}

export default function Payroll() {
  useDocumentTitle('حساب الحلاقين');
  const queryClient = useQueryClient();
  const barbers = useQuery({ queryKey: ['payroll', 'barbers'], queryFn: () => api.get('/payroll/barbers') });
  const history = useQuery({ queryKey: ['payroll', 'settlements'], queryFn: () => api.get('/payroll/settlements') });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['payroll'] });
    queryClient.invalidateQueries({ queryKey: ['drawer'] });
  };

  if (!barbers.data) return <Loading />;
  return (
    <div className="stack lg">
      <PageHead title="حساب الحلاقين" />
      {barbers.data.length === 0 ? <Empty icon="chair">ضيف الحلاقين الأول من صفحة الحلاقين.</Empty> : (
        <div className="pay-grid">
          {barbers.data.map((barber) => <BarberPay key={barber.id} barber={barber} onChanged={refresh} />)}
        </div>
      )}

      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">الحسابات اللي اتقفلت</h2></div>
        <div className="panel-body">
          {!history.data ? <Loading /> : history.data.length === 0 ? <p className="small muted">لسه مفيش.</p> : (
            <ul className="visit-list">
              {history.data.map((row) => (
                <li key={row.id}>
                  <span className="bold">أ. {row.barber_name}</span>
                  <span className="grow small muted">
                    {row.period_from ? `${formatDate(row.period_from)} ← ` : ''}{formatDate(row.period_to)}
                    {' · '}{row.settled_via === 'drawer' ? 'من الدرج' : row.settled_via === 'outside' ? 'برّه الدرج' : 'صفر'}
                    {row.note && ` · ${row.note}`}
                  </span>
                  <span className={`num bold ${row.net < 0 ? 'danger-text' : ''}`}>{formatMoney(Math.abs(row.net), { sign: row.net < 0 ? '−' : '' })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
