/**
 * التجهيز لأوّل مرّة: المواعيد ← قايمة الأسعار ← الحلاقين ← التلفزيون.
 * مفيش بيانات تجريبية: القايمة المقترحة بتظهر للمالك يعدّلها أو يشيل منها،
 * ومحدش بيتحفظ غير اللي هو اختاره.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { inputToMinor, minorToInput } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Checkbox, Input, Loading, Notice } from '../components/ui/index.js';
import { LeatherButton, MarkerNote, Mirror } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';
import HoursEditor from '../components/shop/HoursEditor.jsx';
import { useSetupState } from '../components/layout/Shell.jsx';

const DEFAULT_HOURS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '12:00', closes_at: '00:00' }));

const SUGGESTED = [
  { name: 'قص', price: 8000, minutes: 25 },
  { name: 'دقن', price: 4000, minutes: 15 },
  { name: 'قص ودقن', price: 11000, minutes: 35 },
  { name: 'تنظيف بشرة', price: 15000, minutes: 30 },
  { name: 'صبغة', price: 20000, minutes: 45 },
  { name: 'شمع', price: 5000, minutes: 10 },
];

function Step({ number, title, done, open, onOpen, children }) {
  return (
    <Mirror as="section" className={`setup-step ${open ? 'open' : ''}`.trim()}>
      <button type="button" className="setup-step-head" onClick={onOpen} aria-expanded={open}>
        <span className="setup-number ticket-number">{number}</span>
        <span className="grow bold">{title}</span>
        {done && <MarkerNote ok>خلص ✓</MarkerNote>}
      </button>
      {open && <div className="setup-step-body stack">{children}</div>}
    </Mirror>
  );
}

function HoursStep({ onDone }) {
  const [periods, setPeriods] = useState(DEFAULT_HOURS);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api.put('/shop/hours', { periods }); onDone(); } catch (failure) { setError(failure.errors?.periods ?? failure.message); } finally { setBusy(false); }
  }
  return (
    <>
      <p className="small muted">المقترح: من 12 الضهر لحد نص الليل كل يوم. عدّل زي ما المحل بيشتغل.</p>
      <HoursEditor value={periods} onChange={setPeriods} error={error} />
      <div className="row end"><LeatherButton loading={busy} onClick={save}>حفظ المواعيد</LeatherButton></div>
    </>
  );
}

function ServicesStep({ onDone }) {
  const [rows, setRows] = useState(SUGGESTED.map((row) => ({ ...row, on: true, priceText: minorToInput(row.price) })));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const update = (index, patch) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function save() {
    const chosen = rows.filter((row) => row.on && row.name.trim());
    if (chosen.length === 0) { setError('اختار خدمة واحدة على الأقل'); return; }
    const items = chosen.map((row) => ({ name: row.name.trim(), price: inputToMinor(row.priceText), default_minutes: Number(row.minutes) }));
    if (items.some((item) => item.price === null || !item.default_minutes)) { setError('كل خدمة محتاجة سعر ومدّة'); return; }
    setBusy(true);
    try { await api.post('/services/bulk', { items }); onDone(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }

  return (
    <>
      <p className="small muted">قايمة مقترحة — شيل اللي المحل مش بيعمله، وعدّل الأسعار والمدد. تقدر تزوّد بعدين من «قايمة الأسعار».</p>
      {error && <Notice tone="danger" icon="alert">{error}</Notice>}
      <div className="setup-services">
        <span /><span className="small muted">الخدمة</span><span className="small muted">السعر (ج)</span><span className="small muted">دقايق</span>
        {rows.map((row, index) => (
          <div key={index} className={`setup-service ${row.on ? '' : 'is-off'}`.trim()}>
            <Checkbox checked={row.on} onChange={(event) => update(index, { on: event.target.checked })} label={<span className="sr-only">{row.name}</span>} />
            <Input value={row.name} onChange={(event) => update(index, { name: event.target.value })} aria-label="الخدمة" maxLength={80} />
            <Input value={row.priceText} onChange={(event) => update(index, { priceText: event.target.value })} aria-label="السعر" inputMode="decimal" dir="ltr" className="ltr-input" />
            <Input type="number" value={row.minutes} onChange={(event) => update(index, { minutes: event.target.value })} aria-label="المدّة" min={1} max={480} />
          </div>
        ))}
      </div>
      <div className="row between">
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setRows((current) => [...current, { name: '', price: 0, minutes: 20, on: true, priceText: '' }])}>خدمة تانية</Button>
        <LeatherButton loading={busy} onClick={save}>حفظ القايمة</LeatherButton>
      </div>
    </>
  );
}

function BarbersStep({ onDone }) {
  const [rows, setRows] = useState([{ name: '', chair: '1', pin: '' }]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const update = (index, patch) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function save() {
    const chosen = rows.filter((row) => row.name.trim());
    if (chosen.length === 0) { setError('اكتب اسم حلاق واحد على الأقل'); return; }
    if (chosen.some((row) => row.pin && !/^\d{4}$/.test(row.pin))) { setError('الـ PIN لازم 4 أرقام (أو سيبه فاضي وحطه بعدين)'); return; }
    setBusy(true);
    try {
      for (const row of chosen) {
        // eslint-disable-next-line no-await-in-loop -- بالترتيب عشان أرقام الكراسي
        await api.post('/barbers', { name: row.name.trim(), chair_no: row.chair ? Number(row.chair) : null, ...(row.pin ? { pin: row.pin } : {}) });
      }
      onDone();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="small muted">الـ PIN (4 أرقام) هو اللي الحلاق بيدخل بيه على تابلت الكرسي أوّل الوردية.</p>
      {error && <Notice tone="danger" icon="alert">{error}</Notice>}
      <div className="setup-barbers">
        <span className="small muted">الاسم</span><span className="small muted">الكرسي</span><span className="small muted">PIN</span>
        {rows.map((row, index) => (
          <div key={index} className="setup-barber">
            <Input value={row.name} onChange={(event) => update(index, { name: event.target.value })} aria-label="الاسم" maxLength={60} />
            <Input type="number" value={row.chair} onChange={(event) => update(index, { chair: event.target.value })} aria-label="الكرسي" min={1} max={99} />
            <Input value={row.pin} onChange={(event) => update(index, { pin: event.target.value.replace(/\D/g, '').slice(0, 4) })} aria-label="PIN" inputMode="numeric" dir="ltr" className="ltr-input" />
          </div>
        ))}
      </div>
      <div className="row between">
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setRows((current) => [...current, { name: '', chair: String(current.length + 1), pin: '' }])}>حلاق تاني</Button>
        <LeatherButton loading={busy} onClick={save}>حفظ الحلاقين</LeatherButton>
      </div>
    </>
  );
}

export default function Setup() {
  useDocumentTitle('تجهيز المحل');
  const toast = useToast();
  const queryClient = useQueryClient();
  const setup = useSetupState(true);
  const [open, setOpen] = useState(null);

  if (setup.loading) return <Loading />;
  const done = { hours: !setup.missing.hours, services: !setup.missing.services, barbers: !setup.missing.barbers };
  const firstOpen = !done.hours ? 1 : !done.services ? 2 : !done.barbers ? 3 : 4;
  const current = open ?? firstOpen;
  const finished = (message) => async () => {
    await queryClient.invalidateQueries();
    toast.success(message);
    setOpen(null);
  };

  return (
    <div className="stack lg setup">
      <PageHead title="تجهيز المحل" />
      <p className="muted">أربع خطوات قبل ما الزباين ياخدوا أدوار. كل خطوة تقدر ترجعلها بعدين من الإعدادات.</p>
      <Step number={1} title="المواعيد" done={done.hours} open={current === 1} onOpen={() => setOpen(1)}>
        {done.hours ? <p>المواعيد متسجّلة. <Link to="/settings">عدّلها من الإعدادات</Link></p> : <HoursStep onDone={finished('اتحفظت المواعيد')} />}
      </Step>
      <Step number={2} title="قايمة الأسعار" done={done.services} open={current === 2} onOpen={() => setOpen(2)}>
        {done.services ? <p>القايمة جاهزة. <Link to="/services">عدّلها من قايمة الأسعار</Link></p> : <ServicesStep onDone={finished('اتحفظت القايمة')} />}
      </Step>
      <Step number={3} title="الحلاقين" done={done.barbers} open={current === 3} onOpen={() => setOpen(3)}>
        {done.barbers ? <p>الحلاقين متسجّلين. <Link to="/barbers">صفحة الحلاقين</Link></p> : <BarbersStep onDone={finished('اتحفظ الحلاقين')} />}
      </Step>
      <Step number={4} title="شاشة التلفزيون" done={false} open={current === 4} onOpen={() => setOpen(4)}>
        <p>اربط تلفزيون المحل عشان الزباين يشوفوا أرقامهم ويعملوا «وصلت» بالكود اللي عليه. اختياري بس مهم.</p>
        <div className="row"><Link className="btn" to="/devices">اربط التلفزيون</Link><Link className="btn ghost" to="/">روح للطابور</Link></div>
      </Step>
    </div>
  );
}
