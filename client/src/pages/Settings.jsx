/**
 * الإعدادات (المالك بس): بيانات المحل، والمواعيد، وقواعد الطابور، ورابط المحل.
 * كل لوح بيتحفظ لوحده، وكل تغيير بيتسجّل في السجل.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Field, Input, Loading, Notice, Segmented, Switch } from '../components/ui/index.js';
import { LeatherButton } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';
import HoursEditor from '../components/shop/HoursEditor.jsx';

export const CUSTOMER_APP_URL = import.meta.env.VITE_CUSTOMER_APP_URL || 'http://localhost:5201';

function Panel({ title, children, footer }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2 className="panel-title">{title}</h2></div>
      <div className="panel-body stack">{children}</div>
      {footer && <div className="panel-foot">{footer}</div>}
    </section>
  );
}

function ShopInfo({ shop }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm({
    name: shop.name, phone: shop.phone ?? '', whatsapp: shop.whatsapp ?? '', address: shop.address ?? '', city: shop.city ?? '',
  });
  const [message, setMessage] = useState(null);
  const save = useMutation({
    mutationFn: () => api.patch('/shop', {
      name: form.values.name.trim(), phone: form.values.phone.trim() || null, whatsapp: form.values.whatsapp.trim() || null,
      address: form.values.address.trim() || null, city: form.values.city.trim() || null,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shop'] }); toast.success('اتحفظت بيانات المحل'); setMessage(null); },
    onError: (error) => setMessage(form.fail(error)),
  });
  return (
    <Panel title="بيانات المحل" footer={<Button onClick={() => save.mutate()} loading={save.isPending}>حفظ البيانات</Button>}>
      {message && <Notice tone="danger" icon="alert">{message}</Notice>}
      <div className="grid cols-2">
        <Field label="اسم المحل" error={form.errors.name} required>
          {(props) => <Input {...props} value={form.values.name} onChange={form.on('name')} maxLength={120} />}
        </Field>
        <Field label="المدينة" error={form.errors.city}>
          {(props) => <Input {...props} value={form.values.city} onChange={form.on('city')} maxLength={80} />}
        </Field>
        <Field label="التليفون" error={form.errors.phone}>
          {(props) => <Input {...props} type="tel" dir="ltr" className="ltr-input" value={form.values.phone} onChange={form.on('phone')} />}
        </Field>
        <Field label="واتساب" error={form.errors.whatsapp}>
          {(props) => <Input {...props} type="tel" dir="ltr" className="ltr-input" value={form.values.whatsapp} onChange={form.on('whatsapp')} />}
        </Field>
      </div>
      <Field label="العنوان" error={form.errors.address}>
        {(props) => <Input {...props} value={form.values.address} onChange={form.on('address')} maxLength={255} />}
      </Field>
    </Panel>
  );
}

function Hours({ shop }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [periods, setPeriods] = useState(shop.hours);
  const [error, setError] = useState(null);
  useEffect(() => setPeriods(shop.hours), [shop.hours]);
  const save = useMutation({
    mutationFn: () => api.put('/shop/hours', { periods }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shop'] }); toast.success('اتحفظت المواعيد'); setError(null); },
    onError: (failure) => setError(failure.errors?.periods ?? failure.message),
  });
  return (
    <Panel title="المواعيد" footer={<Button onClick={() => save.mutate()} loading={save.isPending}>حفظ المواعيد</Button>}>
      <p className="small muted">
        {shop.now.open ? 'المحل فاتح دلوقتي.' : 'المحل قافل دلوقتي.'}
        {' '}الفترة اللي بتقفل بعد نص الليل بتتحسب على يوم بدايتها.
      </p>
      <HoursEditor value={periods} onChange={setPeriods} error={error} />
    </Panel>
  );
}

function Rules({ shop }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const initial = shop.settings;
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  useEffect(() => setValues(initial), [initial]);
  const set = (key) => (value) => setValues((current) => ({ ...current, [key]: value }));
  const num = (key) => (event) => set(key)(event.target.value === '' ? '' : Number(event.target.value));

  const save = useMutation({
    mutationFn: () => api.patch('/shop/settings', {
      ...values,
      max_tickets_per_day: values.max_tickets_per_day === '' || values.max_tickets_per_day === null ? null : Number(values.max_tickets_per_day),
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shop'] }); toast.success('اتحفظت القواعد'); setErrors({}); },
    onError: (failure) => { setErrors(failure.errors ?? {}); toast.error(failure.message); },
  });

  return (
    <Panel title="قواعد الطابور" footer={<LeatherButton onClick={() => save.mutate()} loading={save.isPending}>حفظ القواعد</LeatherButton>}>
      <Switch checked={values.remote_tickets_enabled} onChange={set('remote_tickets_enabled')} label="الزباين ياخدوا دور من البيت (التطبيق)" />
      <div className="grid cols-3">
        <Field label="مهلة اللي اتنادى (دقيقة)" hint="بعدها بيتأخّر خطوتين، والتانية ما جاش" error={errors.grace_minutes}>
          {(props) => <Input {...props} type="number" min={2} max={60} value={values.grace_minutes} onChange={num('grace_minutes')} />}
        </Field>
        <Field label="«قرّب دورك» لما يفضل" hint="عدد الأدوار قدّامه" error={errors.notify_ahead}>
          {(props) => <Input {...props} type="number" min={1} max={10} value={values.notify_ahead} onChange={num('notify_ahead')} />}
        </Field>
        <Field label="كام مرّة «أخّرني»" error={errors.max_delays}>
          {(props) => <Input {...props} type="number" min={0} max={5} value={values.max_delays} onChange={num('max_delays')} />}
        </Field>
        <Field label="أقصى أدوار في اليوم" hint="فاضي = من غير حدّ (مفيد قبل العيد)" error={errors.max_tickets_per_day}>
          {(props) => <Input {...props} type="number" min={1} max={2000} value={values.max_tickets_per_day ?? ''} onChange={num('max_tickets_per_day')} />}
        </Field>
        <Field label="بطّل أدوار البيت قبل القفل بـ (دقيقة)" error={errors.close_buffer_minutes}>
          {(props) => <Input {...props} type="number" min={0} max={240} value={values.close_buffer_minutes} onChange={num('close_buffer_minutes')} />}
        </Field>
      </div>
      <div className="field">
        <span className="label">الأسماء على شاشة التلفزيون</span>
        <Segmented
          label="الأسماء على التلفزيون"
          value={values.display_name_style}
          onChange={set('display_name_style')}
          options={[{ value: 'first_initial', label: '«12 — أحمد م.»' }, { value: 'number_only', label: 'الرقم بس' }]}
        />
      </div>
    </Panel>
  );
}

function ShopLink({ shop }) {
  const toast = useToast();
  const link = `${CUSTOMER_APP_URL}/s/${shop.slug}`;
  return (
    <Panel title="رابط المحل للزباين">
      <p className="small muted">ده الرابط اللي الزباين بياخدوا منه دور. نفس الرابط في الـ QR على شاشة التلفزيون.</p>
      <div className="row wrap">
        <code className="ltr shop-link">{link}</code>
        <Button size="sm" icon="copy" onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success('اتنسخ'))}>انسخ</Button>
      </div>
    </Panel>
  );
}

export default function Settings() {
  useDocumentTitle('الإعدادات');
  const shop = useQuery({ queryKey: ['shop'], queryFn: () => api.get('/shop') });
  if (!shop.data) return <Loading />;
  return (
    <div className="stack lg settings">
      <PageHead title="الإعدادات" />
      <Rules shop={shop.data} />
      <Hours shop={shop.data} />
      <ShopInfo shop={shop.data} />
      <ShopLink shop={shop.data} />
    </div>
  );
}
