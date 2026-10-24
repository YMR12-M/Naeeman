/**
 * أجهزة المحل (المالك بس): التلفزيون، وتابلت الباب، وتابلت الكرسي.
 * «اربط جهاز» بيطلّع كود من 6 أرقام صالح 10 دقايق ومرّة واحدة. الجهاز
 * بيفتح الصفحة بتاعته ويدخّل الكود. الإلغاء بيقفل الجهاز فورًا.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { Icon } from '../lib/icons.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Button, Empty, Field, Input, Loading, Modal, Notice, useConfirm,
} from '../components/ui/index.js';
import { LeatherButton, MarkerNote, Mirror, TicketNumber } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';

const TYPES = [
  { type: 'display', label: 'شاشة التلفزيون', icon: 'tv', path: '/display', hint: 'حيطة المرايات: الأرقام والجايين وكود «وصلت»' },
  { type: 'kiosk', label: 'تابلت الباب', icon: 'door', path: '/kiosk', hint: 'الزبون اللي داخل من الشارع ياخد دوره' },
  { type: 'chair', label: 'تابلت الكرسي', icon: 'chair', path: '/chair', hint: 'زرار «التالي» للحلاق' },
];
const TYPE = Object.fromEntries(TYPES.map((item) => [item.type, item]));

function Countdown({ until }) {
  const [left, setLeft] = useState(() => Math.max(0, until - Date.now()));
  useEffect(() => {
    const timer = setInterval(() => setLeft(Math.max(0, until - Date.now())), 1000);
    return () => clearInterval(timer);
  }, [until]);
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return left > 0
    ? <span className="small muted">صالح لمدّة <span className="num">{minutes}:{String(seconds).padStart(2, '0')}</span></span>
    : <span className="small" style={{ color: 'var(--danger)' }}>الكود انتهى — اطلب واحد جديد</span>;
}

function PairModal({ onClose }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState('display');
  const [name, setName] = useState('');
  const [pairing, setPairing] = useState(null);
  const [error, setError] = useState(null);
  const create = useMutation({
    mutationFn: () => api.post('/devices/pairing-code', { type, name: name.trim() || null }),
    onSuccess: (data) => setPairing({ ...data, until: Date.now() + data.expires_in_minutes * 60_000 }),
    onError: (failure) => setError(failure.message),
  });
  const close = () => { queryClient.invalidateQueries({ queryKey: ['devices'] }); onClose(); };
  const url = `${window.location.origin}${TYPE[type].path}`;

  return (
    <Modal open onClose={close} title="اربط جهاز"
      footer={pairing
        ? <Button onClick={close}>تمام</Button>
        : <><Button onClick={close}>رجوع</Button><LeatherButton loading={create.isPending} onClick={() => create.mutate()}>طلّع الكود</LeatherButton></>}>
      {pairing ? (
        <div className="stack center pairing">
          <p>افتح على الجهاز:</p>
          <code className="ltr shop-link">{url}</code>
          <p>ودخّل الكود ده:</p>
          <Mirror arch className="pairing-code"><TicketNumber value={pairing.code} size="3.2rem" /></Mirror>
          <Countdown until={pairing.until} />
          <MarkerNote>الكود مرّة واحدة بس</MarkerNote>
        </div>
      ) : (
        <div className="stack">
          {error && <Notice tone="danger" icon="alert">{error}</Notice>}
          <div className="device-types" role="radiogroup" aria-label="نوع الجهاز">
            {TYPES.map((item) => (
              <button key={item.type} type="button" role="radio" aria-checked={type === item.type} className={`device-type ${type === item.type ? 'on' : ''}`.trim()} onClick={() => setType(item.type)}>
                <Icon name={item.icon} size={26} />
                <span className="bold">{item.label}</span>
                <span className="small muted">{item.hint}</span>
              </button>
            ))}
          </div>
          <Field label="اسم الجهاز" hint={`اختياري — مثلًا «${type === 'chair' ? 'كرسي 2' : type === 'kiosk' ? 'تابلت الباب' : 'تلفزيون الصالة'}»`}>
            {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />}
          </Field>
        </div>
      )}
    </Modal>
  );
}

export default function Devices() {
  useDocumentTitle('الأجهزة');
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [pairing, setPairing] = useState(false);
  const list = useQuery({ queryKey: ['devices'], queryFn: () => api.get('/devices'), refetchInterval: 30_000 });

  async function revoke(device) {
    const answer = await confirm({ title: `إلغاء «${device.name}»؟`, message: 'الجهاز هيتقفل فورًا ومش هيرجع غير بكود ربط جديد.', confirmLabel: 'ألغِ الجهاز', danger: true });
    if (!answer) return;
    try {
      await api.del(`/devices/${device.id}`);
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      toast.success('الجهاز اتلغى');
    } catch (error) {
      toast.error(error.message);
    }
  }

  if (!list.data) return <Loading />;
  const online = (device) => device.last_seen_at && Date.now() - new Date(device.last_seen_at).getTime() < 3 * 60_000;

  return (
    <div className="stack lg">
      <PageHead title="الأجهزة">
        <LeatherButton onClick={() => setPairing(true)}>اربط جهاز</LeatherButton>
      </PageHead>

      {list.data.length === 0 ? (
        <Mirror>
          <Empty icon="tv" title="مفيش أجهزة مربوطة">
            اربط شاشة التلفزيون عشان الزباين يشوفوا أرقامهم ويعملوا «وصلت»، وتابلت الباب لزباين الشارع، وتابلت لكل كرسي.
          </Empty>
        </Mirror>
      ) : (
        <div className="panel">
          <div className="panel-body flush table-wrap">
            <table className="table">
              <thead><tr><th>الجهاز</th><th>النوع</th><th>آخر ظهور</th><th>عليه دلوقتي</th><th /></tr></thead>
              <tbody>
                {list.data.map((device) => (
                  <tr key={device.id}>
                    <td><span className="row tight"><Icon name={TYPE[device.type].icon} size={18} /><span className="bold">{device.name}</span></span></td>
                    <td>{TYPE[device.type].label}</td>
                    <td>
                      <span className={`badge ${online(device) ? 'ok' : ''}`}>{online(device) ? 'شغّال' : 'مش ظاهر'}</span>
                      {' '}<span className="small muted">{formatDateTime(device.last_seen_at)}</span>
                    </td>
                    <td>{device.type === 'chair' ? (device.current_barber_name ?? <span className="muted">مفيش حد</span>) : '—'}</td>
                    <td className="actions"><Button size="sm" variant="danger" onClick={() => revoke(device)}>ألغِ</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pairing && <PairModal onClose={() => setPairing(false)} />}
    </div>
  );
}
