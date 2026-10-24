import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { Button, Field, Input, Notice } from '../components/ui/index.js';
import { Mirror, Sign, Wordmark } from '../components/brand/index.jsx';

/**
 * باب المحل: حيطة نعناعي فوق، وبلاط تحت، واليافطة، والفورم جوّه مراية.
 * العنوان الحقيقي (h1) جوّه المراية؛ اليافطة زينة.
 */
export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <div className="auth-center">
        <div className="auth-box">
          <Sign size="lg" aria-hidden="true"><Wordmark height="1.3em" /></Sign>
          <Mirror className="stack lg">
            <div>
              <h1 className="auth-title">{title}</h1>
              {subtitle && <p className="muted">{subtitle}</p>}
            </div>
            {children}
          </Mirror>
          {footer}
        </div>
      </div>
      <div className="tiles" aria-hidden="true" />
    </div>
  );
}

export default function Login() {
  useDocumentTitle('تسجيل الدخول');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const form = useForm({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const user = await login(form.values.email.trim(), form.values.password);
      navigate(user.must_change_password ? '/change-password' : (location.state?.from ?? '/'), { replace: true });
    } catch (error) {
      setMessage(form.fail(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="اتفضّل"
      subtitle="ادخل على لوحة المحل"
      footer={<Link className="small" to="/forgot-password">نسيت كلمة المرور؟</Link>}
    >
      <form className="stack" onSubmit={submit} noValidate>
        {location.state?.notice && <Notice icon="check">{location.state.notice}</Notice>}
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Field label="البريد الإلكتروني" error={form.errors.email}>
          {(props) => <Input {...props} type="email" autoComplete="username" autoFocus dir="ltr" className="ltr-input" value={form.values.email} onChange={form.on('email')} required />}
        </Field>
        <Field label="كلمة المرور" error={form.errors.password}>
          {(props) => <Input {...props} type="password" autoComplete="current-password" dir="ltr" className="ltr-input" value={form.values.password} onChange={form.on('password')} required />}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>دخول</Button>
      </form>
    </AuthLayout>
  );
}
