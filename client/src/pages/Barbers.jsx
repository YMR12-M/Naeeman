/**
 * الحلاقين: كل حلاق في مراية مقوّسة بصورته (أو أوّل حرف من اسمه)، ورقم
 * كرسيه، وحالته، وهل ليه PIN لتابلت الكرسي. الـ PIN ما بيرجعش أبدًا من
 * السيرفر — بيتكتب جديد بس.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { BARBER_STATUS_LABELS } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Button, Empty, Field, Input, Loading, Menu, MenuItem, Modal, Notice, useConfirm,
} from '../components/ui/index.js';
import { LeatherButton, MarkerNote, Mirror, Portrait } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';

const pinOk = (pin) => /^\d{4}$/.test(pin);

function BarberModal({ barber, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useForm({ name: barber?.name ?? '', chair_no: barber?.chair_no ?? '', pin: '' });
  const [message, setMessage] = useState(null);
  const save = useMutation({
    mutationFn: (body) => (barber ? api.patch(`/barbers/${barber.id}`, body) : api.post('/barbers', body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['barbers'] });
      toast.success(barber ? 'اتعدّل' : 'اتضاف الحلاق');
      onClose();
    },
    onError: (error) => setMessage(form.fail(error)),
  });

  function submit(event) {
    event.preventDefault();
    const body = { name: form.values.name.trim(), chair_no: form.values.chair_no === '' ? null : Number(form.values.chair_no) };
    if (!barber && form.values.pin) {
      if (!pinOk(form.values.pin)) { form.setErrors({ pin: 'الـ PIN لازم 4 أرقام' }); return; }
      body.pin = form.values.pin;
    }
    save.mutate(body);
  }

  return (
    <Modal open onClose={onClose} title={barber ? `تعديل ${barber.name}` : 'حلاق جديد'} size="narrow"
      footer={<><Button onClick={onClose}>رجوع</Button><LeatherButton type="submit" form="barber-form" loading={save.isPending}>حفظ</LeatherButton></>}>
      <form id="barber-form" className="stack" onSubmit={submit} noValidate>
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Field label="الاسم" error={form.errors.name} required>
          {(props) => <Input {...props} value={form.values.name} onChange={form.on('name')} maxLength={60} autoFocus />}
        </Field>
        <Field label="رقم الكرسي" hint="اختياري" error={form.errors.chair_no}>
          {(props) => <Input {...props} type="number" min={1} max={99} value={form.values.chair_no} onChange={form.on('chair_no')} />}
        </Field>
        {!barber && (
          <Field label="PIN تابلت الكرسي" hint="4 أرقام — الحلاق بيدخل بيه أوّل الوردية" error={form.errors.pin}>
            {(props) => <Input {...props} inputMode="numeric" maxLength={4} dir="ltr" className="ltr-input pin-input" value={form.values.pin} onChange={form.on('pin')} />}
          </Field>
        )}
      </form>
    </Modal>
  );
}

function PinModal({ barber, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const save = useMutation({
    mutationFn: () => api.put(`/barbers/${barber.id}/pin`, { pin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['barbers'] });
      toast.success(`اتغيّر PIN ${barber.name} — قوله عليه`);
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });
  return (
    <Modal open onClose={onClose} title={`PIN جديد لـ ${barber.name}`} size="narrow"
      footer={<><Button onClick={onClose}>رجوع</Button><LeatherButton loading={save.isPending} disabled={!pinOk(pin)} onClick={() => save.mutate()}>حفظ</LeatherButton></>}>
      <div className="stack">
        <p className="small muted">الـ PIN الجديد بيفكّ القفل لو الحلاق غلط فيه كتير.</p>
        <Field label="PIN" error={error}>
          {(props) => <Input {...props} inputMode="numeric" maxLength={4} dir="ltr" className="ltr-input pin-input" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} autoFocus />}
        </Field>
      </div>
    </Modal>
  );
}

export default function Barbers() {
  useDocumentTitle('الحلاقين');
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [pinFor, setPinFor] = useState(null);
  const list = useQuery({ queryKey: ['barbers', 'all'], queryFn: () => api.get('/barbers', { include_archived: true }) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['barbers'] });
  };
  const run = async (action, success) => {
    try { await action(); refresh(); if (success) toast.success(success); } catch (error) { toast.error(error.message); }
  };

  if (!list.data) return <Loading />;
  const current = list.data.filter((barber) => !barber.archived_at);
  const archived = list.data.filter((barber) => barber.archived_at);

  async function archive(barber) {
    const answer = await confirm({ title: `شيل ${barber.name} من المحل؟`, message: 'هيتشال من الطابور والتطبيق، وأدواره القديمة فاضلة. تقدر ترجّعه بعدين.', confirmLabel: 'شيله', danger: true });
    if (answer) run(() => api.del(`/barbers/${barber.id}`));
  }

  return (
    <div className="stack lg">
      <PageHead title="الحلاقين">
        {can('barbers.write') && <LeatherButton onClick={() => setEditing('new')}>حلاق جديد</LeatherButton>}
      </PageHead>

      {current.length === 0 ? (
        <Mirror><Empty icon="chair" title="مفيش حلاقين لسه">ضيف الحلاقين عشان الزباين يختاروا ويتحسب الوقت المتوقّع.</Empty></Mirror>
      ) : (
        <div className="barber-grid">
          {current.map((barber) => (
            <Mirror arch key={barber.id} className="barber-card">
              <Portrait name={barber.name} src={barber.photo_path} large />
              <div className="center">
                <div className="bold">{barber.name}</div>
                <div className="small muted">{barber.chair_no ? <>كرسي <span className="num">{barber.chair_no}</span></> : 'من غير كرسي'}</div>
              </div>
              <span className={`badge ${barber.status === 'available' ? 'ok' : barber.status === 'break' ? 'warn' : ''}`}>{BARBER_STATUS_LABELS[barber.status]}</span>
              {!barber.has_pin && <MarkerNote>محتاج PIN</MarkerNote>}
              <div className="row tight">
                {can('barbers.status') && (
                  <Menu trigger={<Button size="sm">الحالة</Button>}>
                    <MenuItem icon="check" onClick={() => run(() => api.post(`/barbers/${barber.id}/status`, { status: 'available' }))}>متاح</MenuItem>
                    <MenuItem icon="coffee" onClick={() => run(() => api.post(`/barbers/${barber.id}/status`, { status: 'break', break_minutes: 15 }))}>استراحة ربع ساعة</MenuItem>
                    <MenuItem icon="logout" onClick={() => run(() => api.post(`/barbers/${barber.id}/status`, { status: 'off' }))}>مش موجود النهارده</MenuItem>
                  </Menu>
                )}
                {can('barbers.write') && (
                  <Menu trigger={<Button size="sm" variant="ghost" icon="more" aria-label={`أفعال ${barber.name}`} />}>
                    <MenuItem icon="edit" onClick={() => setEditing(barber)}>تعديل الاسم والكرسي</MenuItem>
                    <MenuItem icon="key" onClick={() => setPinFor(barber)}>{barber.has_pin ? 'PIN جديد' : 'حط PIN'}</MenuItem>
                    <hr />
                    <MenuItem icon="trash" danger onClick={() => archive(barber)}>شيله من المحل</MenuItem>
                  </Menu>
                )}
              </div>
            </Mirror>
          ))}
        </div>
      )}

      {archived.length > 0 && can('barbers.write') && (
        <div className="stack sm">
          <span className="small muted">اتشالوا من المحل</span>
          <ul className="archived-list">
            {archived.map((barber) => (
              <li key={barber.id} className="row between">
                <span>{barber.name}</span>
                <Button size="sm" onClick={() => run(() => api.post(`/barbers/${barber.id}/restore`), `${barber.name} رجع`)}>رجّعه</Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && <BarberModal barber={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {pinFor && <PinModal barber={pinFor} onClose={() => setPinFor(null)} />}
    </div>
  );
}
