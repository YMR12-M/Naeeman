/**
 * خُد دور: الخدمات ← الحلاق أو «أي حد» ← تأكيد فيه الوقت المتوقّع
 * والسعر. بعدها على «دوري» على طول، وهناك بنطلب الإشعارات.
 */
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatMinutes, formatMoney } from '../lib/format.js';
import { Icon } from '../lib/icons.jsx';
import { LeatherButton, MarkerNote, Mirror, Portrait, PriceRow } from '../components/brand/index.jsx';
import { Button, Loading, Notice } from '../components/ui/index.js';
import { closedReason } from './Shop.jsx';

const STEPS = ['الخدمة', 'الحلاق', 'تأكيد'];

export default function Take() {
  useDocumentTitle('خُد دورك');
  const { slug } = useParams();
  const navigate = useNavigate();
  const shopQuery = useQuery({ queryKey: ['shop', slug], queryFn: () => api.public(`/public/shops/${slug}`) });
  const active = useQuery({ queryKey: ['active-ticket'], queryFn: () => api.get('/me/tickets/active') });
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState([]);
  const [barberId, setBarberId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const shop = shopQuery.data;
  const chosen = useMemo(() => (shop?.services ?? []).filter((service) => selected.includes(service.id)), [shop, selected]);
  const total = chosen.reduce((sum, service) => sum + service.price, 0);

  if (active.data?.ticket) return <Navigate to={`/turn/${active.data.ticket.id}`} replace />;
  if (!shop || active.isLoading) return shopQuery.error ? <Notice tone="danger" icon="alert">{shopQuery.error.message}</Notice> : <Loading />;

  const reason = closedReason(shop);
  const barber = shop.barbers.find((item) => item.id === barberId) ?? null;
  const wait = barber ? barber.wait_minutes : shop.wait_minutes;
  const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  async function take() {
    setBusy(true);
    setError(null);
    try {
      const view = await api.act('/me/tickets', { shop_slug: slug, service_ids: selected, barber_id: barberId });
      // «دوري» بيحدّث كاش الدور الشغّال بنفسه. لو اتحدّث هنا، الصفحة دي كانت بتحوّل
      // لـ «دوري» من غير ?new=1 قبل التنقّل ده، وطلب الإشعارات ما بيظهرش.
      navigate(`/turn/${view.ticket.id}?new=1`, { replace: true });
    } catch (failure) {
      // دور اتاخد من تبويب تاني: نروح له بدل رسالة خطأ
      if (failure.code === 'ACTIVE_TICKET_EXISTS') { await active.refetch(); return; }
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack lg">
      <ol className="steps" aria-label="الخطوات">
        {STEPS.map((label, index) => (
          <li key={label} className={index + 1 === step ? 'on' : index + 1 < step ? 'done' : ''}>
            <span className="num">{index + 1}</span>{label}
          </li>
        ))}
      </ol>

      {reason && <Notice icon="info">{reason}</Notice>}
      {error && <Notice tone="danger" icon="alert">{error}</Notice>}

      {step === 1 && (
        <section className="stack">
          <h1 className="page-title">عايز تعمل إيه؟</h1>
          <div className="pick-list">
            {shop.services.map((service) => {
              const on = selected.includes(service.id);
              return (
                <button key={service.id} type="button" aria-pressed={on} className={`pick ${on ? 'on' : ''}`.trim()} onClick={() => toggle(service.id)}>
                  <PriceRow
                    name={<span className="row tight">{on ? <Icon name="check" size={18} /> : <span className="pick-box" />}{service.name}</span>}
                    price={service.price}
                  />
                </button>
              );
            })}
          </div>
          <div className="sticky-foot">
            <span className="muted">الإجمالي <span className="num bold">{formatMoney(total)}</span></span>
            <LeatherButton disabled={selected.length === 0} onClick={() => setStep(2)}>الجاي</LeatherButton>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="stack">
          <h1 className="page-title">مع مين؟</h1>
          <div className="pick-grid">
            <button type="button" className={`pick barber ${barberId === null ? 'on' : ''}`.trim()} aria-pressed={barberId === null} onClick={() => setBarberId(null)}>
              <span className="portrait"><Icon name="users" size={22} /></span>
              <span className="bold">أي حد فاضي</span>
              <span className="small muted">{shop.wait_minutes === null ? '—' : `حوالي ${formatMinutes(shop.wait_minutes)}`}</span>
            </button>
            {shop.barbers.map((item) => (
              <button key={item.id} type="button" className={`pick barber ${barberId === item.id ? 'on' : ''}`.trim()} aria-pressed={barberId === item.id} onClick={() => setBarberId(item.id)}>
                <Portrait name={item.name} src={item.photo_path} />
                <span className="bold">أ. {item.name}</span>
                <span className="small muted">{item.status === 'break' ? 'في الاستراحة' : item.wait_minutes === null ? '—' : `حوالي ${formatMinutes(item.wait_minutes)}`}</span>
              </button>
            ))}
          </div>
          <div className="sticky-foot">
            <Button onClick={() => setStep(1)}>رجوع</Button>
            <LeatherButton onClick={() => setStep(3)}>الجاي</LeatherButton>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="stack">
          <h1 className="page-title">تمام كده؟</h1>
          <Mirror className="stack page-card">
            {chosen.map((service) => <PriceRow key={service.id} name={service.name} price={service.price} />)}
            <PriceRow className="bold" name="الإجمالي التقريبي" price={total} />
            <p className="small muted">الدفع في المحل. الحلاق ممكن يزوّد خدمة لو طلبت.</p>
          </Mirror>
          <Mirror thin className="stack page-card">
            <span>مع: <span className="bold">{barber ? `أ. ${barber.name}` : 'أي حد فاضي'}</span></span>
            <MarkerNote>{wait === null ? 'مفيش حلاق فاضي دلوقتي' : wait === 0 ? 'دورك تقريبًا دلوقتي' : `دورك بعد حوالي ${formatMinutes(wait)}`}</MarkerNote>
          </Mirror>
          <div className="sticky-foot">
            <Button onClick={() => setStep(2)}>رجوع</Button>
            <LeatherButton loading={busy} disabled={Boolean(reason)} onClick={take}>خُد دورك</LeatherButton>
          </div>
        </section>
      )}
    </div>
  );
}
