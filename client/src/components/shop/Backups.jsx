/**
 * النسخ الاحتياطية (وضع «المحل هو السيرفر»، المالك بس): آخر نسخة، ونسخة
 * دلوقتي، واسترجاع نسخة. الاسترجاع بيمسح البيانات الحالية ويحط النسخة،
 * وبيعمل نسخة أمان من الحالة الحالية الأوّل.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useHub } from '../../lib/hub.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Button, Loading, useConfirm } from '../ui/index.js';

export const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
};

export default function Backups() {
  const hub = useHub();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const enabled = Boolean(hub.data?.enabled);
  const list = useQuery({ queryKey: ['hub-backups'], queryFn: () => api.get('/hub/backups'), enabled });
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['hub-backups'] }); queryClient.invalidateQueries({ queryKey: ['hub'] }); };
  const fail = (error) => toast.error(error.message);

  const create = useMutation({
    mutationFn: () => api.post('/hub/backups'),
    onSuccess: (data) => { refresh(); toast.success(data.copied ? 'النسخة اتعملت واتنسخت للسحابة' : 'النسخة اتعملت'); },
    onError: fail,
  });
  const restore = useMutation({
    mutationFn: (name) => api.post('/hub/backups/restore', { name, confirm: true }),
    onSuccess: () => { toast.success('اتسترجعت — بنحدّث الصفحة'); setTimeout(() => window.location.reload(), 1500); },
    onError: fail,
  });

  if (!enabled) return null;
  const { backup } = hub.data;

  async function askRestore(item) {
    const answer = await confirm({
      title: 'ترجّع النسخة دي؟',
      message: `كل البيانات الحالية (الأدوار والفواتير والمنتجات…) هتتمسح ويرجع اللي كان وقت ${formatDateTime(item.created_at)}. هنعمل نسخة من الحالة دلوقتي الأوّل عشان تقدر ترجع لها.`,
      confirmLabel: 'استرجع',
      danger: true,
    });
    if (answer) restore.mutate(item.name);
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2 className="panel-title">النسخ الاحتياطية</h2></div>
      <div className="panel-body stack">
        <p className="small muted">
          بتتعمل نسخة كل <span className="num">{backup.every_hours}</span> ساعات وبعد كل تقفيل يوم، وبنحتفظ بآخر <span className="num">{backup.keep}</span> نسخة على الكمبيوتر ده.
          {backup.copy_dir
            ? <> وبتتنسخ كمان لـ <code className="ltr">{backup.copy_dir}</code> (فتطلع على السحابة).</>
            : <> عشان تطلع على Google Drive أو OneDrive اختار الفولدر بتاعه من قايمة «نعيمًا» ← «فولدر النسخ على السحابة».</>}
        </p>
        <div className="row wrap">
          <Button variant="primary" icon="download" loading={create.isPending} onClick={() => create.mutate()}>انسخ دلوقتي</Button>
          {backup.latest && <span className="small muted">آخر نسخة: {formatDateTime(backup.latest.created_at)}</span>}
        </div>
        {!list.data ? <Loading /> : list.data.length === 0 ? <p className="small muted">لسه مفيش نسخ.</p> : (
          <ul className="method-list">
            {list.data.slice(0, 8).map((item) => (
              <li key={item.name}>
                <span className="grow">{formatDateTime(item.created_at)}</span>
                <span className="small muted num">{formatBytes(item.bytes)}</span>
                <Button size="sm" variant="danger" disabled={restore.isPending} onClick={() => askRestore(item)}>استرجع</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
