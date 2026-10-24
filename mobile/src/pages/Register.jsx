import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { Field, Input, Notice } from '../components/ui/index.js';
import { LeatherButton } from '../components/brand/index.jsx';
import AuthLayout from '../components/AuthLayout.jsx';
import { safeNext } from '../lib/nav.js';

/** حساب جديد: الاسم والموبايل وكلمة سر، والبريد اختياري (للاستعادة) */
export default function Register() {
  useDocumentTitle('حساب جديد');
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const form = useForm({ name: '', phone: '', password: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await register({
        name: form.values.name.trim(),
        phone: form.values.phone.trim(),
        password: form.values.password,
        email: form.values.email.trim() || null,
      });
      navigate(next, { replace: true });
    } catch (error) {
      setMessage(form.fail(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="حساب جديد"
      subtitle="مرّة واحدة بس، وبعدها تاخد دورك بلمستين"
      footer={<span className="small">عندك حساب؟ <Link to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`}>ادخل</Link></span>}
    >
      <form className="stack" onSubmit={submit} noValidate>
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Field label="اسمك" hint="ده اللي هيتنادى بيه وهيظهر على شاشة المحل (الاسم الأوّل وحرف)" error={form.errors.name}>
          {(props) => <Input {...props} autoComplete="name" autoFocus maxLength={60} value={form.values.name} onChange={form.on('name')} />}
        </Field>
        <Field label="رقم الموبايل" error={form.errors.phone}>
          {(props) => <Input {...props} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" className="ltr-input" value={form.values.phone} onChange={form.on('phone')} placeholder="01xxxxxxxxx" />}
        </Field>
        <Field label="كلمة السر" hint="8 حروف على الأقل" error={form.errors.password}>
          {(props) => <Input {...props} type="password" autoComplete="new-password" dir="ltr" className="ltr-input" value={form.values.password} onChange={form.on('password')} />}
        </Field>
        <Field label="البريد (اختياري)" hint="لو نسيت كلمة السر يوصلك رابط عليه" error={form.errors.email}>
          {(props) => <Input {...props} type="email" autoComplete="email" dir="ltr" className="ltr-input" value={form.values.email} onChange={form.on('email')} />}
        </Field>
        <LeatherButton type="submit" block loading={busy}>اعمل الحساب</LeatherButton>
      </form>
    </AuthLayout>
  );
}
