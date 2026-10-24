/**
 * حسابي: الاسم والبريد (البريد بيخلّي استعادة كلمة السر من غير المحل)،
 * وتغيير كلمة السر، والإشعارات، وشكل التطبيق، والخروج.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatPhone } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Mirror } from '../components/brand/index.jsx';
import { Button, Field, Input, Notice, Segmented, useConfirm } from '../components/ui/index.js';
import PushPrompt from '../components/PushPrompt.jsx';

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
