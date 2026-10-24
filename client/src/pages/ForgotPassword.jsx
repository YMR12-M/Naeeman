import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { Button, Field, Input, Notice } from '../components/ui/index.js';
import { AuthLayout } from './Login.jsx';

export default function ForgotPassword() {
  useDocumentTitle('استعادة كلمة المرور');
  const form = useForm({ email: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/auth/forgot-password', { email: form.values.email.trim() }, { auth: false });
      setSent(true);
    } catch (error) {
      setMessage(form.fail(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="استعادة كلمة المرور"
      subtitle="اكتب بريدك وهنبعتلك رابط لتغيير كلمة المرور"
      footer={<p className="center small"><Link to="/login">رجوع لتسجيل الدخول</Link></p>}
    >
      {sent ? (
        <Notice tone="success" icon="check">لو البريد مسجّل عندنا هيوصلك رابط الاستعادة خلال دقائق. الرابط صالح لمدّة ساعة.</Notice>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {message && <Notice tone="danger" icon="alert">{message}</Notice>}
          <Field label="البريد الإلكتروني" error={form.errors.email}>
            {(props) => <Input {...props} type="email" autoFocus dir="ltr" className="ltr-input" value={form.values.email} onChange={form.on('email')} required />}
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>إرسال الرابط</Button>
        </form>
      )}
    </AuthLayout>
  );
}
