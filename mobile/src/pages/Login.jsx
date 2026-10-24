import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { Field, Input, Notice } from '../components/ui/index.js';
import { LeatherButton } from '../components/brand/index.jsx';
import AuthLayout from '../components/AuthLayout.jsx';
import { safeNext } from '../lib/nav.js';

/** الدخول برقم الموبايل وكلمة السر (مفيش SMS) */
export default function Login() {
  useDocumentTitle('الدخول');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const form = useForm({ phone: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await login(form.values.phone.trim(), form.values.password);
      navigate(next, { replace: true });
    } catch (error) {
      setMessage(form.fail(error));
    } finally {
      setBusy(false);
    }
  }

  const withNext = (path) => (next === '/' ? path : `${path}?next=${encodeURIComponent(next)}`);

  return (
    <AuthLayout
      title="اتفضّل"
      subtitle="ادخل برقم موبايلك عشان تاخد دورك"
      footer={(
        <div className="stack center small">
          <span>أوّل مرّة؟ <Link to={withNext('/register')}>اعمل حساب في دقيقة</Link></span>
          <Link to="/forgot-password">نسيت كلمة السر؟</Link>
        </div>
      )}
    >
      <form className="stack" onSubmit={submit} noValidate>
        {location.state?.notice && <Notice icon="check">{location.state.notice}</Notice>}
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Field label="رقم الموبايل" error={form.errors.phone}>
          {(props) => <Input {...props} type="tel" inputMode="tel" autoComplete="tel" autoFocus dir="ltr" className="ltr-input" value={form.values.phone} onChange={form.on('phone')} placeholder="01xxxxxxxxx" />}
        </Field>
        <Field label="كلمة السر" error={form.errors.password}>
          {(props) => <Input {...props} type="password" autoComplete="current-password" dir="ltr" className="ltr-input" value={form.values.password} onChange={form.on('password')} />}
        </Field>
        <LeatherButton type="submit" block loading={busy}>دخول</LeatherButton>
      </form>
    </AuthLayout>
  );
}
