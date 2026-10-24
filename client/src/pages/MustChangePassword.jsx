import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { Button, Field, Input, Notice } from '../components/ui/index.js';
import { AuthLayout } from './Login.jsx';

/** حساب جديد أو كلمة مؤقتة: لا شيء آخر في النظام قبل تغييرها */
export default function MustChangePassword() {
  useDocumentTitle('تغيير كلمة المرور');
  const { adoptSession, logout } = useAuth();
  const navigate = useNavigate();
  const form = useForm({ current: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (form.values.password !== form.values.confirm) {
      form.setErrors({ confirm: 'كلمتا المرور مش متطابقتين' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const data = await api.post('/auth/change-password', { current_password: form.values.current, new_password: form.values.password });
      await adoptSession(data);
      navigate('/', { replace: true });
    } catch (error) {
      setMessage(form.fail(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="غيّر كلمة المرور"
      subtitle="حسابك بكلمة مؤقتة — اختار كلمة مرور خاصة بيك"
      footer={<p className="center small"><button type="button" className="btn ghost sm" onClick={logout}>تسجيل الخروج</button></p>}
    >
      <form className="stack" onSubmit={submit} noValidate>
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Field label="كلمة المرور الحالية (المؤقتة)" error={form.errors.current_password}>
          {(props) => <Input {...props} type="password" autoComplete="current-password" autoFocus dir="ltr" className="ltr-input" value={form.values.current} onChange={form.on('current')} required />}
        </Field>
        <Field label="كلمة المرور الجديدة" hint="10 حروف على الأقل، وتجمع نوعين" error={form.errors.new_password}>
          {(props) => <Input {...props} type="password" autoComplete="new-password" dir="ltr" className="ltr-input" value={form.values.password} onChange={form.on('password')} required />}
        </Field>
        <Field label="تأكيد كلمة المرور" error={form.errors.confirm}>
          {(props) => <Input {...props} type="password" autoComplete="new-password" dir="ltr" className="ltr-input" value={form.values.confirm} onChange={form.on('confirm')} required />}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>حفظ ومتابعة</Button>
      </form>
    </AuthLayout>
  );
}
