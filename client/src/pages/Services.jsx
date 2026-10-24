/**
 * قايمة الأسعار: زي اللوح اللي على حيطة المحل — الخدمة ونقط وبعدين السعر.
 * الترتيب هنا هو ترتيب ظهورها في التطبيق وتابلت الباب. الخدمة ما بتتمسحش:
 * بتتأرشف وتقدر ترجّعها.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useForm } from '../lib/forms.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatMinutes } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Button, Empty, Field, Input, Loading, Modal, MoneyInput, Notice, Switch, useConfirm,
} from '../components/ui/index.js';
import { LeatherButton, Mirror, PriceRow } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';

function ServiceModal({ service, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useForm({
    name: service?.name ?? '', price: service?.price ?? null, default_minutes: service?.default_minutes ?? 25,
  });
  const [message, setMessage] = useState(null);
  const save = useMutation({
    mutationFn: (body) => (service ? api.patch(`/services/${service.id}`, body) : api.post('/services', body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success(service ? 'اتعدّلت' : 'اتضافت للقايمة');
      onClose();
    },
    onError: (error) => setMessage(form.fail(error)),
  });

  function submit(event) {
    event.preventDefault();
    if (form.values.price === null) { form.setErrors({ price: 'اكتب السعر' }); return; }
    save.mutate({ name: form.values.name.trim(), price: form.values.price, default_minutes: Number(form.values.default_minutes) });
  }

  return (
    <Modal open onClose={onClose} title={service ? `تعديل «${service.name}»` : 'خدمة جديدة'} size="narrow"
      footer={<><Button onClick={onClose}>رجوع</Button><LeatherButton type="submit" form="service-form" loading={save.isPending}>حفظ</LeatherButton></>}>
      <form id="service-form" className="stack" onSubmit={submit} noValidate>
        {message && <Notice tone="danger" icon="alert">{message}</Notice>}
        <Field label="الخدمة" error={form.errors.name} required>
          {(props) => <Input {...props} value={form.values.name} onChange={form.on('name')} maxLength={80} autoFocus placeholder="قص ودقن" />}
        </Field>
        <div className="grid cols-2">
          <Field label="السعر" error={form.errors.price} required>
            {(props) => <MoneyInput {...props} currency="ج" value={form.values.price} onChange={(value) => form.set('price', value)} />}
          </Field>
          <Field label="المدّة بالدقايق" hint="مبدئيًا — السيستم بيتعلّم مدّة كل حلاق" error={form.errors.default_minutes} required>
            {(props) => <Input {...props} type="number" min={1} max={480} value={form.values.default_minutes} onChange={form.on('default_minutes')} />}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

export default function Services() {
  useDocumentTitle('قايمة الأسعار');
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const editable = can('services.write');
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const list = useQuery({ queryKey: ['services', 'all'], queryFn: () => api.get('/services', { include_archived: true }) });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['services'] });
  const fail = (error) => toast.error(error.message);
  const reorder = useMutation({ mutationFn: (ids) => api.put('/services/order', { ids }), onSuccess: refresh, onError: fail });
  const toggle = useMutation({ mutationFn: ({ id, active }) => api.patch(`/services/${id}`, { active }), onSuccess: refresh, onError: fail });
  const restore = useMutation({ mutationFn: (id) => api.post(`/services/${id}/restore`), onSuccess: refresh, onError: fail });

  if (!list.data) return <Loading />;
  const current = list.data.filter((service) => !service.archived_at);
  const archived = list.data.filter((service) => service.archived_at);

  function move(index, delta) {
    const ids = current.map((service) => service.id);
    const [item] = ids.splice(index, 1);
    ids.splice(index + delta, 0, item);
    reorder.mutate(ids);
  }

  async function archive(service) {
    const answer = await confirm({ title: `أرشفة «${service.name}»؟`, message: 'هتختفي من القايمة والتطبيق، والأدوار القديمة فاضلة زي ما هي. تقدر ترجّعها بعدين.', confirmLabel: 'أرشف', danger: true });
    if (!answer) return;
    try { await api.del(`/services/${service.id}`); refresh(); } catch (error) { fail(error); }
  }

  return (
    <div className="stack lg">
      <PageHead title="قايمة الأسعار">
        {editable && <LeatherButton onClick={() => setEditing('new')}>خدمة جديدة</LeatherButton>}
      </PageHead>

      <Mirror className="price-board">
        {current.length === 0 ? (
          <Empty icon="list" title="القايمة فاضية">ضيف الخدمات اللي المحل بيعملها بأسعارها.</Empty>
        ) : (
          <ol className="price-list">
            {current.map((service, index) => (
              <li key={service.id} className={service.active ? '' : 'is-off'}>
                <PriceRow
                  className="grow"
                  name={<span className="bold">{service.name}</span>}
                  price={service.price}
                  suffix={<span className="small muted nowrap">{formatMinutes(service.default_minutes)}</span>}
                />
                {editable && (
                  <div className="row tight price-tools">
                    <Switch checked={service.active} onChange={(active) => toggle.mutate({ id: service.id, active })} label={<span className="sr-only">متاحة</span>} />
                    <Button size="sm" variant="ghost" icon="arrow-up" aria-label="لفوق" disabled={index === 0 || reorder.isPending} onClick={() => move(index, -1)} />
                    <Button size="sm" variant="ghost" icon="arrow-down" aria-label="لتحت" disabled={index === current.length - 1 || reorder.isPending} onClick={() => move(index, 1)} />
                    <Button size="sm" variant="ghost" icon="edit" aria-label={`تعديل ${service.name}`} onClick={() => setEditing(service)} />
                    <Button size="sm" variant="ghost" icon="trash" aria-label={`أرشفة ${service.name}`} onClick={() => archive(service)} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Mirror>
      {current.some((service) => !service.active) && <p className="small muted">الخدمة الموقوفة (باهتة) مش بتظهر للزباين لحد ما تشغّلها.</p>}

      {archived.length > 0 && (
        <div className="stack sm">
          <Button variant="ghost" size="sm" onClick={() => setShowArchived((value) => !value)}>
            {showArchived ? 'اخفي المؤرشف' : `المؤرشف (${archived.length})`}
          </Button>
          {showArchived && (
            <ul className="archived-list">
              {archived.map((service) => (
                <li key={service.id} className="row between">
                  <span>{service.name}</span>
                  {editable && <Button size="sm" onClick={() => restore.mutate(service.id)}>رجّعها</Button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && <ServiceModal service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
