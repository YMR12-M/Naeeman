import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { Button, Field, Input, Notice } from '../components/ui/index.js';
import { AuthLayout } from './Login.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const invite = params.get('invite') === '1';
  useDocumentTitle(invite ? 'تحديد كلمة المرور' : 'تغيير كلمة المرور');

  const navigate = useNavigate();
  const form = useForm({ password: '', confirm: '' });
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
      await api.post('/auth/reset-password', { token, new_password: form.values.password }, { auth: false });
      navigate('/login', { replace: true, state: { notice: 'تمّ تغيير كلمة المرور — سجّل الدخول' } });
    } catch (error) {
      const mapped = error.errors?.new_password ? { password: error.errors.new_password } : null;
      if (mapped) form.setErrors(mapped);
      else setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="رابط غير صالح" footer={<p className="center small"><Link to="/forgot-password">اطلب رابطًا جديدًا</Link></p>}>
        <Notice tone="danger" icon="alert">الرابط ناقص أو انتهت صلاحيته.</Notice>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={invite ? 'أهلًا بيك في المحل' : 'كلمة مرور جديدة'} subtitle={invite ? 'حدّد كلمة مرورك عشان تبدأ' : 'اختار كلمة مرور قوية'}>
      <form className="stack" onSubmit={submit} noValidate>
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Field label="كلمة المرور الجديدة" hint="10 حروف على الأقل، وتجمع نوعين (حروف وأرقام مثلًا)" error={form.errors.password}>
          {(props) => <Input {...props} type="password" autoComplete="new-password" autoFocus dir="ltr" className="ltr-input" value={form.values.password} onChange={form.on('password')} required />}
        </Field>
        <Field label="تأكيد كلمة المرور" error={form.errors.confirm}>
          {(props) => <Input {...props} type="password" autoComplete="new-password" dir="ltr" className="ltr-input" value={form.values.confirm} onChange={form.on('confirm')} required />}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>حفظ</Button>
      </form>
    </AuthLayout>
  );
}
