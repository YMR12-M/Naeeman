/** كلمة سر جديدة من رابط البريد (`/reset-password?token=…`) */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { Field, Input, Notice } from '../components/ui/index.js';
import { LeatherButton } from '../components/brand/index.jsx';
import AuthLayout from '../components/AuthLayout.jsx';

export default function ResetPassword() {
  useDocumentTitle('كلمة سر جديدة');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const form = useForm({ new_password: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/customer-auth/reset-password', { token, new_password: form.values.new_password }, { auth: false });
      navigate('/login', { replace: true, state: { notice: 'كلمة السر اتغيّرت — ادخل بالجديدة' } });
    } catch (error) {
      setMessage(form.fail(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="كلمة سر جديدة" footer={<Link className="small" to="/forgot-password">اطلب رابط جديد</Link>}>
      {!token ? <Notice tone="danger" icon="alert">الرابط ناقص — افتحه من البريد تاني.</Notice> : (
        <form className="stack" onSubmit={submit} noValidate>
          {message && <Notice tone="danger" icon="alert">{message}</Notice>}
          <Field label="كلمة السر الجديدة" hint="8 حروف على الأقل" error={form.errors.new_password}>
            {(props) => <Input {...props} type="password" autoComplete="new-password" autoFocus dir="ltr" className="ltr-input" value={form.values.new_password} onChange={form.on('new_password')} />}
          </Field>
          <LeatherButton type="submit" block loading={busy}>حفظ</LeatherButton>
        </form>
      )}
    </AuthLayout>
  );
}
