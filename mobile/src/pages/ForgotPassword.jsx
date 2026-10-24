/**
 * نسيت كلمة السر — طريقتين:
 *  • عندي بريد في الحساب ← رابط على البريد.
 *  • معايا كود من المحل ← الاستقبال طلّعه وأنا قدّامه (للي مالوش بريد).
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { Field, Input, Notice, Segmented } from '../components/ui/index.js';
import { LeatherButton } from '../components/brand/index.jsx';
import AuthLayout from '../components/AuthLayout.jsx';

function ByEmail() {
  const form = useForm({ phone: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [sent, setSent] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      setSent((await api.post('/customer-auth/forgot-password', { phone: form.values.phone.trim() }, { auth: false })).message);
    } catch (error) {
      setMessage(form.fail(error));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <Notice icon="check">{sent}</Notice>;
  return (
    <form className="stack" onSubmit={submit} noValidate>
      {message && <Notice tone="danger" icon="alert">{message}</Notice>}
      <Field label="رقم الموبايل" hint="لو الحساب فيه بريد، هيوصلك عليه رابط" error={form.errors.phone}>
        {(props) => <Input {...props} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" className="ltr-input" value={form.values.phone} onChange={form.on('phone')} />}
      </Field>
      <LeatherButton type="submit" block loading={busy}>ابعت الرابط</LeatherButton>
    </form>
  );
}

function ByShopCode() {
  const navigate = useNavigate();
  const form = useForm({ phone: '', code: '', new_password: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/customer-auth/reset-with-code', {
        phone: form.values.phone.trim(), code: form.values.code.trim(), new_password: form.values.new_password,
      }, { auth: false });
      navigate('/login', { replace: true, state: { notice: 'كلمة السر اتغيّرت — ادخل بالجديدة' } });
    } catch (error) {
      setMessage(form.fail(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <p className="small muted">اطلب من الاستقبال في المحل «كود استعادة» برقمك. الكود صالح ربع ساعة.</p>
      {message && <Notice tone="danger" icon="alert">{message}</Notice>}
      <Field label="رقم الموبايل" error={form.errors.phone}>
        {(props) => <Input {...props} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" className="ltr-input" value={form.values.phone} onChange={form.on('phone')} />}
      </Field>
      <Field label="الكود (6 أرقام)" error={form.errors.code}>
        {(props) => (
          <Input
            {...props} inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="ltr-input code-input" maxLength={6}
            value={form.values.code} onChange={(event) => form.set('code', event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        )}
      </Field>
      <Field label="كلمة السر الجديدة" hint="8 حروف على الأقل" error={form.errors.new_password}>
        {(props) => <Input {...props} type="password" autoComplete="new-password" dir="ltr" className="ltr-input" value={form.values.new_password} onChange={form.on('new_password')} />}
      </Field>
      <LeatherButton type="submit" block loading={busy}>غيّر كلمة السر</LeatherButton>
    </form>
  );
}

export default function ForgotPassword() {
  useDocumentTitle('نسيت كلمة السر');
  const [method, setMethod] = useState('email');
  return (
    <AuthLayout title="نسيت كلمة السر" footer={<Link className="small" to="/login">رجوع للدخول</Link>}>
      <Segmented
        label="طريقة الاستعادة" value={method} onChange={setMethod}
        options={[{ value: 'email', label: 'على البريد' }, { value: 'shop', label: 'معايا كود من المحل' }]}
      />
      {method === 'email' ? <ByEmail /> : <ByShopCode />}
    </AuthLayout>
  );
}
