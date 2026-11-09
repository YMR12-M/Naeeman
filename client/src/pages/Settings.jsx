/**
 * الإعدادات (المالك بس): بيانات المحل، والمواعيد، وقواعد الطابور، والكاشير
 * والإيصال وطرق الدفع، وكارت الأختام، وتذكير «وحشتنا»، ورابط المحل.
 * كل لوح بيتحفظ لوحده (بيبعت حقوله هو بس)، وكل تغيير بيتسجّل في السجل.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Field, Input, Loading, MoneyInput, Notice, Segmented, Select, Switch } from '../components/ui/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatMoney } from '../lib/format.js';
import { LeatherButton } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';
import HoursEditor from '../components/shop/HoursEditor.jsx';
import Backups from '../components/shop/Backups.jsx';
import { customerOrigin, useHub } from '../lib/hub.js';

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
      remote_tickets_enabled: values.remote_tickets_enabled,
      grace_minutes: values.grace_minutes,
      notify_ahead: values.notify_ahead,
      max_delays: values.max_delays,
      close_buffer_minutes: values.close_buffer_minutes,
      display_name_style: values.display_name_style,
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

/** لوح إعدادات بيحفظ حقوله هو بس */
function useSettingsForm(shop, keys, success) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const pick = (source) => Object.fromEntries(keys.map((key) => [key, source[key]]));
  const [values, setValues] = useState(() => pick(shop.settings));
  const [errors, setErrors] = useState({});
  useEffect(() => setValues(pick(shop.settings)), [shop.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (key) => (value) => setValues((current) => ({ ...current, [key]: value }));
  const save = useMutation({
    mutationFn: (override) => api.patch('/shop/settings', override ?? values),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shop'] }); toast.success(success); setErrors({}); },
    onError: (failure) => { setErrors(failure.errors ?? {}); toast.error(failure.message); },
  });
  return { values, set, errors, save };
}

function CashierSettings({ shop }) {
  const { values, set, errors, save } = useSettingsForm(
    shop,
    ['cashier_enabled', 'max_cashier_discount_pct', 'receipt_width', 'receipt_footer', 'receipt_auto_print'],
    'اتحفظت إعدادات الكاشير',
  );
  return (
    <Panel title="الكاشير والإيصال" footer={<Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>}>
      <Switch checked={values.cashier_enabled} onChange={set('cashier_enabled')} label="الكاشير شغّال: الفاتورة تستنّى الدفع في «الكاشير»" />
      <p className="small muted">
        {values.cashier_enabled
          ? 'الدور لما يخلص فاتورته بتستنّى الاستقبال يحصّلها، والدفع محتاج درج مفتوح.'
          : 'مقفول: الدور لما يخلص بيتسدّد كاش لوحده بإجمالي خدماته (زي ما كان).'}
      </p>
      <div className="grid cols-3">
        <Field label="أقصى خصم للاستقبال" hint="المدير والمالك من غير حد" error={errors.max_cashier_discount_pct}>
          {(props) => (
            <div className="input-group">
              <Input {...props} type="number" min={0} max={100} value={values.max_cashier_discount_pct}
                onChange={(event) => set('max_cashier_discount_pct')(Number(event.target.value))} />
              <span className="addon">%</span>
            </div>
          )}
        </Field>
        <div className="field">
          <span className="label">مقاس الإيصال</span>
          <Segmented label="مقاس الإيصال" value={values.receipt_width} onChange={set('receipt_width')}
            options={[{ value: 80, label: '80 مم' }, { value: 58, label: '58 مم' }]} />
        </div>
        <Field label="آخر سطر في الإيصال" error={errors.receipt_footer}>
          {(props) => <Input {...props} maxLength={190} value={values.receipt_footer ?? ''} onChange={(event) => set('receipt_footer')(event.target.value)} placeholder="نعيمًا، نوّرتنا" />}
        </Field>
      </div>
      <Switch checked={values.receipt_auto_print} onChange={set('receipt_auto_print')} label="اطبع الإيصال لوحده بعد الدفع" />
    </Panel>
  );
}

const METHOD_KINDS = [
  { value: 'card', label: 'كارت' }, { value: 'wallet', label: 'محفظة' }, { value: 'transfer', label: 'تحويل' }, { value: 'other', label: 'تانية' },
];

function PaymentMethods() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api.get('/payment-methods') });
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('wallet');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
  const fail = (error) => toast.error(error.message);
  const add = useMutation({
    mutationFn: () => api.post('/payment-methods', { label: label.trim(), kind }),
    onSuccess: () => { setLabel(''); refresh(); toast.success('اتضافت'); },
    onError: fail,
  });
  const update = useMutation({ mutationFn: ({ id, ...body }) => api.patch(`/payment-methods/${id}`, body), onSuccess: refresh, onError: fail });
  if (!can('payments.manage')) return null;
  return (
    <Panel title="طرق الدفع">
      <p className="small muted">«كاش» بس هو اللي بيدخل الدرج. الطريقة الموقوفة مش بتظهر للكاشير.</p>
      {!methods.data ? <Loading /> : (
        <ul className="method-list">
          {methods.data.map((method) => (
            <li key={method.id} className={method.active ? '' : 'is-off'}>
              <span className="grow bold">{method.label}</span>
              <span className="small muted">{method.kind === 'cash' ? 'بيدخل الدرج' : METHOD_KINDS.find((item) => item.value === method.kind)?.label}</span>
              <Switch checked={method.active} disabled={method.code === 'cash'} onChange={(active) => update.mutate({ id: method.id, active })} label={<span className="sr-only">شغّالة</span>} />
            </li>
          ))}
        </ul>
      )}
      <div className="row wrap">
        <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="طريقة جديدة (فوري، ميزة…)" maxLength={40} style={{ maxWidth: 240 }} aria-label="اسم الطريقة" />
        <Select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="نوعها" style={{ maxWidth: 140 }}>
          {METHOD_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
        <Button icon="plus" disabled={label.trim().length < 2} loading={add.isPending} onClick={() => add.mutate()}>ضيف</Button>
      </div>
    </Panel>
  );
}

function LoyaltySettings({ shop }) {
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get('/services') });
  const { values, set, errors, save } = useSettingsForm(
    shop,
    ['loyalty_enabled', 'loyalty_stamps_required', 'loyalty_reward_type', 'loyalty_reward_service_id', 'loyalty_reward_value', 'loyalty_min_total'],
    'اتحفظ كارت الأختام',
  );
  const type = values.loyalty_reward_type;
  return (
    <Panel title="كارت الأختام" footer={<Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>}>
      <Switch checked={values.loyalty_enabled} onChange={set('loyalty_enabled')} label="كل زيارة مدفوعة بختم، وبعد عدد الأختام الزيارة الجاية مكافأة" />
      <div className="grid cols-3">
        <Field label="المكافأة بعد كام ختم" hint={`يعني الزيارة رقم ${Number(values.loyalty_stamps_required || 0) + 1} مكافأة`} error={errors.loyalty_stamps_required}>
          {(props) => <Input {...props} type="number" min={1} max={50} value={values.loyalty_stamps_required} onChange={(event) => set('loyalty_stamps_required')(Number(event.target.value))} />}
        </Field>
        <Field label="المكافأة" error={errors.loyalty_reward_type}>
          {(props) => (
            <Select {...props} value={type} onChange={(event) => set('loyalty_reward_type')(event.target.value)}>
              <option value="top_service">أغلى خدمة في الزيارة ببلاش</option>
              <option value="service">خدمة معيّنة ببلاش</option>
              <option value="amount">خصم بمبلغ</option>
              <option value="percent">خصم بنسبة</option>
            </Select>
          )}
        </Field>
        {type === 'service' && (
          <Field label="الخدمة" error={errors.loyalty_reward_service_id}>
            {(props) => (
              <Select {...props} value={values.loyalty_reward_service_id ?? ''} onChange={(event) => set('loyalty_reward_service_id')(event.target.value ? Number(event.target.value) : null)}>
                <option value="">اختار…</option>
                {(services.data ?? []).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        {type === 'amount' && (
          <Field label="مبلغ الخصم" error={errors.loyalty_reward_value}>
            {(props) => <MoneyInput {...props} currency="ج" value={values.loyalty_reward_value} onChange={(value) => set('loyalty_reward_value')(value ?? 0)} />}
          </Field>
        )}
        {type === 'percent' && (
          <Field label="نسبة الخصم" error={errors.loyalty_reward_value}>
            {(props) => (
              <div className="input-group">
                <Input {...props} type="number" min={1} max={100} value={values.loyalty_reward_value} onChange={(event) => set('loyalty_reward_value')(Number(event.target.value))} />
                <span className="addon">%</span>
              </div>
            )}
          </Field>
        )}
        <Field label="أقل فاتورة تاخد ختم" hint={values.loyalty_min_total ? `أي فاتورة ${formatMoney(values.loyalty_min_total).replace(/[⁧⁩]/g, '')} أو أكتر` : 'أي زيارة فيها خدمة'} error={errors.loyalty_min_total}>
          {(props) => <MoneyInput {...props} currency="ج" value={values.loyalty_min_total} onChange={(value) => set('loyalty_min_total')(value ?? 0)} />}
        </Field>
      </div>
      <p className="small muted">الزيارة اللي اتصرفت فيها المكافأة ما بتاخدش ختم. والحلاق بياخد نسبته من السعر الكامل (المكافأة على حساب المحل).</p>
    </Panel>
  );
}

function ReminderSettings({ shop }) {
  const { values, set, errors, save } = useSettingsForm(shop, ['reminder_enabled', 'reminder_days'], 'اتحفظ التذكير');
  return (
    <Panel title="تذكير «وحشتنا»" footer={<Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>}>
      <Switch checked={values.reminder_enabled} onChange={set('reminder_enabled')} label="فكّر الزبون لما يبعد عن المحل" />
      <div className="grid cols-3">
        <Field label="بعد كام يوم من آخر زيارة" error={errors.reminder_days}>
          {(props) => <Input {...props} type="number" min={7} max={180} value={values.reminder_days} onChange={(event) => set('reminder_days')(Number(event.target.value))} />}
        </Field>
      </div>
      <p className="small muted">اللي عنده التطبيق بيوصله إشعار مرّة واحدة لكل زيارة (من 11 الصبح لـ 9 بالليل). واللي معندوش بيظهر في «الزباين ← وحشونا» برسالة واتساب جاهزة.</p>
    </Panel>
  );
}

function ShopLink({ shop }) {
  const toast = useToast();
  const hub = useHub();
  // في وضع «المحل هو السيرفر» الزبون على واي فاي المحل بيفتح عنوان الكمبيوتر
  const link = `${customerOrigin(hub.data) ?? CUSTOMER_APP_URL}/s/${shop.slug}`;
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
      <CashierSettings shop={shop.data} />
      <PaymentMethods />
      <LoyaltySettings shop={shop.data} />
      <ReminderSettings shop={shop.data} />
      <Hours shop={shop.data} />
      <ShopInfo shop={shop.data} />
      <ShopLink shop={shop.data} />
      <Backups />
    </div>
  );
}
