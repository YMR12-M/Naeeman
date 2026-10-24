/**
 * الفريق (المالك بس): المدير والاستقبال. الدعوة بالبريد برابط تحديد كلمة
 * المرور، أو كلمة مؤقتة بتظهر مرّة واحدة (لو الموظف مالوش بريد شغّال).
 * الحلاقين مش هنا: ليهم PIN في صفحة الحلاقين.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Button, Checkbox, Field, Input, Loading, Menu, MenuItem, Modal, Notice, Select, useConfirm,
} from '../components/ui/index.js';
import { LeatherButton, Mirror } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';

const ROLES = { owner: 'مالك', manager: 'مدير', cashier: 'استقبال' };
const ROLE_HINTS = {
  manager: 'الطابور كله، والأسعار، والحلاقين، والتقارير',
  cashier: 'الطابور: زبون من الشارع، وصل، ألغِ',
  owner: 'كل حاجة، ومنها الإعدادات والفريق والأجهزة',
};

function TempPassword({ value, onClose }) {
  return (
    <Modal open onClose={onClose} title="كلمة مرور مؤقتة" size="narrow" footer={<Button onClick={onClose}>تمام</Button>}>
      <div className="stack center">
        <p className="small muted">إديها للموظف دلوقتي — مش هتظهر تاني، وهيغيّرها أوّل ما يدخل.</p>
        <Mirror className="temp-pass"><code className="ltr">{value}</code></Mirror>
      </div>
    </Modal>
  );
}

function AddModal({ onClose, onTemp }) {
  const queryClient = useQueryClient();
  const form = useForm({ full_name: '', email: '', role: 'cashier', send_invite: true });
  const [message, setMessage] = useState(null);
  const save = useMutation({
    mutationFn: () => api.post('/users', {
      full_name: form.values.full_name.trim(), email: form.values.email.trim(), role: form.values.role, send_invite: form.values.send_invite,
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
      if (data.temp_password) onTemp(data.temp_password);
    },
    onError: (error) => setMessage(form.fail(error)),
  });
  return (
    <Modal open onClose={onClose} title="موظف جديد" size="narrow"
      footer={<><Button onClick={onClose}>رجوع</Button><LeatherButton loading={save.isPending} onClick={() => save.mutate()}>ضيف</LeatherButton></>}>
      <div className="stack">
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Field label="الاسم" error={form.errors.full_name} required>
          {(props) => <Input {...props} value={form.values.full_name} onChange={form.on('full_name')} autoFocus />}
        </Field>
        <Field label="البريد" error={form.errors.email} required>
          {(props) => <Input {...props} type="email" dir="ltr" className="ltr-input" value={form.values.email} onChange={form.on('email')} />}
        </Field>
        <Field label="الدور" hint={ROLE_HINTS[form.values.role]} error={form.errors.role}>
          {(props) => (
            <Select {...props} value={form.values.role} onChange={form.on('role')}>
              <option value="cashier">استقبال</option>
              <option value="manager">مدير</option>
              <option value="owner">مالك</option>
            </Select>
          )}
        </Field>
        <Checkbox label="ابعتله رابط بالبريد يحدّد بيه كلمة المرور" checked={form.values.send_invite} onChange={form.on('send_invite')} />
      </div>
    </Modal>
  );
}

export default function Team() {
  useDocumentTitle('الفريق');
  const { user, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [temp, setTemp] = useState(null);
  const list = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });

  const run = async (action, success) => {
    try {
      const result = await action();
      queryClient.invalidateQueries({ queryKey: ['users'] });
      if (success) toast.success(success);
      return result;
    } catch (error) {
      toast.error(error.message);
      return null;
    }
  };

  if (!list.data) return <Loading />;

  return (
    <div className="stack lg">
      <PageHead title="الفريق">
        {can('users.write') && <LeatherButton onClick={() => setAdding(true)}>موظف جديد</LeatherButton>}
      </PageHead>
      <p className="small muted">الحلاقين بيدخلوا على تابلت الكرسي بالـ PIN من صفحة الحلاقين — مش محتاجين حساب هنا.</p>

      <div className="panel">
        <div className="panel-body flush table-wrap">
          <table className="table">
            <thead><tr><th>الاسم</th><th>الدور</th><th>الحالة</th><th>آخر دخول</th><th /></tr></thead>
            <tbody>
              {list.data.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div className="bold">{member.full_name}{member.id === user.id && <span className="small muted"> (إنت)</span>}</div>
                    <div className="small muted ltr">{member.email}</div>
                  </td>
                  <td>{ROLES[member.role]}</td>
                  <td>
                    {member.status === 'active'
                      ? (member.must_change_password ? <span className="badge warn">لسه ما دخلش</span> : <span className="badge ok">شغّال</span>)
                      : <span className="badge danger">موقوف</span>}
                  </td>
                  <td className="small muted">{formatDateTime(member.last_login_at)}</td>
                  <td className="actions">
                    {member.id !== user.id && can('users.write') && (
                      <Menu trigger={<Button size="sm" variant="ghost" icon="more" aria-label={`أفعال ${member.full_name}`} />}>
                        {Object.entries(ROLES).filter(([role]) => role !== member.role).map(([role, label]) => (
                          <MenuItem key={role} icon="swap" onClick={() => run(() => api.patch(`/users/${member.id}`, { role }), 'اتغيّر الدور')}>خلّيه {label}</MenuItem>
                        ))}
                        <MenuItem icon="key" onClick={async () => { const result = await run(() => api.post(`/users/${member.id}/temp-password`)); if (result) setTemp(result.temp_password); }}>كلمة مرور مؤقتة</MenuItem>
                        {member.status === 'active'
                          ? <MenuItem icon="ban" onClick={() => run(() => api.patch(`/users/${member.id}`, { status: 'suspended' }), 'اتوقف')}>أوقف الحساب</MenuItem>
                          : <MenuItem icon="check" onClick={() => run(() => api.patch(`/users/${member.id}`, { status: 'active' }), 'رجع')}>رجّع الحساب</MenuItem>}
                        <hr />
                        <MenuItem icon="trash" danger onClick={async () => {
                          const answer = await confirm({ title: `حذف ${member.full_name}؟`, message: 'هيخرج من كل الأجهزة، والسجل القديم فاضل.', confirmLabel: 'احذف', danger: true });
                          if (answer) run(() => api.del(`/users/${member.id}`), 'اتحذف');
                        }}>احذف</MenuItem>
                      </Menu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {adding && <AddModal onClose={() => setAdding(false)} onTemp={setTemp} />}
      {temp && <TempPassword value={temp} onClose={() => setTemp(null)} />}
    </div>
  );
}
