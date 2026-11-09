/**
 * حسابي: الاسم والبريد (البريد بيخلّي استعادة كلمة السر من غير المحل)،
 * وتغيير كلمة السر، والإشعارات، وشكل التطبيق، والخروج.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatDate, formatPhone } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Mirror } from '../components/brand/index.jsx';
import { Button, Field, Input, Notice, Segmented, Switch, useConfirm } from '../components/ui/index.js';
import PushPrompt from '../components/PushPrompt.jsx';
import { AuthImage, LoyaltyNote, StampRow } from '../components/CardBits.jsx';

function Profile() {
  const { customer, setCustomer } = useAuth();
  const toast = useToast();
  const form = useForm({ name: customer.name, email: customer.email ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCustomer(await api.patch('/me', { name: form.values.name.trim(), email: form.values.email.trim() || null }));
      toast.success('اتحفظ');
    } catch (failure) {
      setError(form.fail(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={save} noValidate>
      <h2>بياناتي</h2>
      {error && <Notice tone="danger" icon="alert">{error}</Notice>}
      <p className="small muted">الموبايل: <span className="num">{formatPhone(customer.phone)}</span></p>
      <Field label="الاسم" error={form.errors.name}>
        {(props) => <Input {...props} value={form.values.name} onChange={form.on('name')} maxLength={60} autoComplete="name" />}
      </Field>
      <Field label="البريد (اختياري)" hint="لو نسيت كلمة السر يوصلك رابط عليه. من غيره هتحتاج كود من المحل." error={form.errors.email}>
        {(props) => <Input {...props} type="email" dir="ltr" className="ltr-input" value={form.values.email} onChange={form.on('email')} autoComplete="email" />}
      </Field>
      <Button type="submit" variant="primary" loading={busy}>حفظ</Button>
    </form>
  );
}

/** كروت الأختام في كل محل زرته، ومفتاح «فكّرني لو غبت» لكل محل */
function MyCards() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const cards = useQuery({ queryKey: ['cards'], queryFn: () => api.get('/me/cards') });
  const remind = useMutation({
    mutationFn: ({ shopId, off }) => api.patch(`/me/cards/${shopId}`, { reminders_off: off }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cards'] }),
    onError: (failure) => toast.error(failure.message),
  });

  if (!cards.data || cards.data.length === 0) return null;
  return (
    <Mirror className="page-card stack">
      <h2>كروتي</h2>
      {cards.data.map((card) => (
        <div key={card.id} className="stack sm my-card">
          <div className="row between">
            <span className="bold">{card.shop_name}</span>
            <span className="xsmall muted">زرت <span className="num">{card.visits}</span> {card.visits === 1 ? 'مرّة' : 'مرّات'}</span>
          </div>
          <StampRow loyalty={card.loyalty} size="sm" />
          <LoyaltyNote loyalty={card.loyalty} />
          <Switch
            checked={!card.reminders_off}
            disabled={remind.isPending}
            onChange={(on) => remind.mutate({ shopId: card.shop_id, off: !on })}
            label="فكّروني لو غبت عن المحل ده"
          />
        </div>
      ))}
    </Mirror>
  );
}

/** «قصّاتي»: الصور اللي الحلاق صوّرها، وليّا أمسحها */
function MyCuts() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const photos = useQuery({ queryKey: ['photos'], queryFn: () => api.get('/me/photos') });

  async function remove(photo) {
    const answer = await confirm({ title: 'تمسح الصورة دي؟', message: 'هتتمسح من عندك ومن كارتك في المحل، ومينفعش ترجع.', confirmLabel: 'امسح', danger: true });
    if (!answer) return;
    try {
      await api.del(`/me/photos/${photo.id}`);
      toast.success('اتمسحت');
      queryClient.invalidateQueries({ queryKey: ['photos'] });
    } catch (failure) {
      toast.error(failure.message);
    }
  }

  if (!photos.data || photos.data.length === 0) return null;
  return (
    <Mirror className="page-card stack">
      <h2>قصّاتي</h2>
      <ul className="photo-grid">
        {photos.data.map((photo) => (
          <li key={photo.id} className="photo-item">
            <AuthImage path={`/me/photos/${photo.id}`} alt={`قصّة عند ${photo.shop_name}`} />
            <span className="xsmall muted">
              {photo.shop_name}{photo.barber_name ? ` · أ. ${photo.barber_name}` : ''}
              <br />{formatDate(String(photo.created_at).slice(0, 10))}
            </span>
            <button type="button" className="photo-remove" aria-label="امسح الصورة" onClick={() => remove(photo)}>×</button>
          </li>
        ))}
      </ul>
    </Mirror>
  );
}

function ChangePassword() {
  const { adopt } = useAuth();
  const toast = useToast();
  const form = useForm({ current_password: '', new_password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      adopt(await api.post('/me/change-password', form.values));
      form.reset({ current_password: '', new_password: '' });
      toast.success('كلمة السر اتغيّرت، وأي جهاز تاني اتطلّع برّه');
    } catch (failure) {
      setError(form.fail(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={save} noValidate>
      <h2>كلمة السر</h2>
      {error && <Notice tone="danger" icon="alert">{error}</Notice>}
      <Field label="كلمة السر الحالية" error={form.errors.current_password}>
        {(props) => <Input {...props} type="password" value={form.values.current_password} onChange={form.on('current_password')} autoComplete="current-password" />}
      </Field>
      <Field label="كلمة السر الجديدة" hint="8 حروف على الأقل" error={form.errors.new_password}>
        {(props) => <Input {...props} type="password" value={form.values.new_password} onChange={form.on('new_password')} autoComplete="new-password" />}
      </Field>
      <Button type="submit" loading={busy}>غيّر كلمة السر</Button>
    </form>
  );
}

export default function Account() {
  useDocumentTitle('حسابي');
  const { logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const confirm = useConfirm();

  async function signOut() {
    if (await confirm({ title: 'تخرج من حسابك؟', message: 'دورك (لو معاك) هيفضل زي ما هو، وتقدر تدخل تاني في أي وقت.', confirmLabel: 'خروج' })) logout();
  }

  return (
    <div className="stack lg">
      <h1 className="page-title">حسابي</h1>
      <Mirror className="page-card"><Profile /></Mirror>
      <PushPrompt compact />
      <MyCards />
      <MyCuts />
      <Mirror className="page-card stack">
        <h2>شكل التطبيق</h2>
        <Segmented
          label="شكل التطبيق" value={preference} onChange={setPreference}
          options={[{ value: 'auto', label: 'زي الموبايل' }, { value: 'light', label: 'نهار' }, { value: 'dark', label: 'ليل' }]}
        />
      </Mirror>
      <Mirror className="page-card"><ChangePassword /></Mirror>
      <Button variant="ghost" icon="logout" onClick={signOut}>خروج</Button>
    </div>
  );
}
