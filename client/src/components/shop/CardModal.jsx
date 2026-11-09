/**
 * كارت الزبون: الملاحظات، وصور القصّات، والأختام، والزيارات.
 * بيتفتح من صفحة الزباين ومن الطابور.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { Icon } from '../../lib/icons.jsx';
import { formatDate, formatDateTime, formatMoney, formatPhone, whatsappLink } from '../../lib/format.js';
import { shrinkImage } from '../../lib/image.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Button, Field, Input, Loading, Modal, Notice, Switch, Textarea, useConfirm,
} from '../ui/index.js';
import { LeatherButton, Mirror } from '../brand/index.jsx';
import { AuthImage, LoyaltyNote, StampRow } from './CardBits.jsx';

const EVENT_LABELS = { earn: 'ختم', redeem: 'صرف المكافأة', adjust: 'تعديل', merge: 'دمج' };

/**
 * كود ربط الكارت بحساب التطبيق: رقم الحساب مش متأكّد منه، فالكارت (بأختامه
 * وصوره) ما بيترَبطش لوحده. الاستقبال بيطلّع الكود وهو شايف صاحب الكارت.
 */
function LinkCodeModal({ card, onClose }) {
  const toast = useToast();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  async function issue() {
    setBusy(true);
    try { setResult(await api.post(`/cards/${card.id}/link-code`)); } catch (error) { toast.error(error.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="ربط الكارت بالتطبيق" size="narrow"
      footer={result ? <LeatherButton onClick={onClose}>تمام</LeatherButton>
        : <><Button onClick={onClose}>رجوع</Button><LeatherButton loading={busy} onClick={issue}>طلّع الكود</LeatherButton></>}>
      {result ? (
        <div className="stack center">
          <p>الكود لكارت <span className="bold">{result.card.name}</span> (<span className="num">{formatPhone(result.card.phone)}</span>)</p>
          <Mirror arch className="pair-code">
            <span className="ticket-number" dir="ltr" style={{ fontSize: 'clamp(2.4rem, 9vw, 3.4rem)', letterSpacing: '0.12em' }}>{result.code}</span>
          </Mirror>
          <p className="small muted">
            الزبون يفتح التطبيق ← «حسابي» ← «عندك كارت في محل؟»، ويكتب الكود. لازم يكون مسجّل بنفس الرقم.
            الكود صالح <span className="num">{result.expires_in_minutes}</span> دقيقة ومرّة واحدة.
          </p>
        </div>
      ) : (
        <div className="stack">
          <p className="soft">
            الزبون ده عنده كارت بأختامه وصور قصّاته من قبل التطبيق. لما يكتب الكود في التطبيق، الكارت ده يبقى على حسابه.
          </p>
          <Notice icon="alert">اتأكد إن ده صاحب الكارت فعلًا (بالشكل، أو بآخر صورة قصّة) قبل ما تديله الكود.</Notice>
        </div>
      )}
    </Modal>
  );
}

function StampsModal({ card, onClose, onDone }) {
  const toast = useToast();
  const [delta, setDelta] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.post(`/cards/${card.id}/stamps`, { delta: Number(delta), note: note.trim() });
      toast.success('الأختام اتعدّلت');
      onDone();
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="تعديل الأختام" size="narrow"
      footer={<><Button onClick={onClose}>رجوع</Button><Button variant="primary" loading={busy} disabled={!Number(delta) || note.trim().length < 2} onClick={save}>حفظ</Button></>}>
      <div className="stack">
        <Field label="كام ختم" hint="سالب للشيل، مثلًا -1">
          {(props) => <Input {...props} type="number" min={-50} max={50} value={delta} onChange={(event) => setDelta(event.target.value)} />}
        </Field>
        <Field label="السبب" required>
          {(props) => <Input {...props} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ختم اتنسى في زيارة امبارح" />}
        </Field>
      </div>
    </Modal>
  );
}

export default function CardModal({ cardId, onClose }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const file = useRef(null);
  const card = useQuery({ queryKey: ['card', cardId], queryFn: () => api.get(`/cards/${cardId}`) });
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stamps, setStamps] = useState(false);
  const [linking, setLinking] = useState(false);
  const [viewing, setViewing] = useState(null);

  useEffect(() => { if (card.data) setNotes(card.data.notes ?? ''); }, [card.data?.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['card', cardId] });
    queryClient.invalidateQueries({ queryKey: ['cards'] });
  };

  async function patch(body, success) {
    setSaving(true);
    try { await api.patch(`/cards/${cardId}`, body); refresh(); if (success) toast.success(success); } catch (error) { toast.error(error.message); } finally { setSaving(false); }
  }

  async function upload(event) {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    setUploading(true);
    try {
      await api.upload(`/cards/${cardId}/photos`, await shrinkImage(chosen));
      refresh();
      toast.success('الصورة اتحفظت');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(photo) {
    const answer = await confirm({ title: 'مسح الصورة؟', message: 'الصورة هتتمسح من الكارت ومن تطبيق الزبون.', confirmLabel: 'امسح', danger: true });
    if (!answer) return;
    try { await api.del(`/cards/${cardId}/photos/${photo.id}`); setViewing(null); refresh(); } catch (error) { toast.error(error.message); }
  }

  const data = card.data;
  return (
    <Modal open onClose={onClose} title={data ? data.name : 'كارت الزبون'} size="wide"
      footer={<Button onClick={onClose}>خلاص</Button>}>
      {!data ? <Loading /> : (
        <div className="card-view">
          <div className="stack">
            <div className="row wrap small">
              {data.phone && <a className="num" href={`tel:${data.phone}`}>{data.phone}</a>}
              {data.phone && (
                <a href={whatsappLink(data.phone, `أهلًا ${data.name.split(' ')[0]}`)} target="_blank" rel="noreferrer" className="row tight">
                  <Icon name="whatsapp" size={16} />واتساب
                </a>
              )}
              {!data.phone && data.app_phone && <span className="muted" title="الرقم اللي اتسجّل بيه في التطبيق (مش متأكّد منه)"><span className="num">{data.app_phone}</span> (من التطبيق)</span>}
              <span className={`badge ${data.has_app ? 'ok' : ''}`}>{data.has_app ? 'عنده التطبيق' : 'من غير تطبيق'}</span>
              {!data.has_app && data.phone && can('cards.write') && (
                <Button size="sm" variant="ghost" icon="link" onClick={() => setLinking(true)}>ربط بالتطبيق</Button>
              )}
            </div>

            <div className="card-stats">
              <div><span className="num bold">{data.visits}</span><span className="small muted">زيارة</span></div>
              <div><span className="num bold">{formatMoney(data.total_spent)}</span><span className="small muted">صرف</span></div>
              <div><span className="bold">{data.last_visit_at ? formatDate(String(data.last_visit_at).slice(0, 10)) : '—'}</span><span className="small muted">آخر زيارة</span></div>
              {data.last_barber && <div><span className="bold">أ. {data.last_barber.name}</span><span className="small muted">آخر حلاق</span></div>}
            </div>

            {data.loyalty.enabled && (
              <div className="stack xs">
                <div className="row between">
                  <StampRow loyalty={data.loyalty} />
                  {can('cards.stamps') && <Button size="sm" variant="ghost" icon="edit" onClick={() => setStamps(true)}>عدّل</Button>}
                </div>
                <LoyaltyNote loyalty={data.loyalty} />
              </div>
            )}

            <Field label="ملاحظات للحلاق" hint="بتظهر على تابلت الكرسي لما الزبون يقعد">
              {(props) => (
                <Textarea {...props} rows={3} maxLength={1000} value={notes} disabled={!can('cards.write')}
                  onChange={(event) => setNotes(event.target.value)} placeholder="درجة 2 على الجناب، ما بيحبش الجِل…" />
              )}
            </Field>
            {can('cards.write') && (
              <div className="row between wrap">
                <Switch checked={!data.reminders_off} onChange={(on) => patch({ reminders_off: !on })} label="تذكير «وحشتنا»" disabled={saving} />
                <Button size="sm" loading={saving} disabled={notes === (data.notes ?? '')} onClick={() => patch({ notes }, 'الملاحظات اتحفظت')}>احفظ الملاحظات</Button>
              </div>
            )}

            <section className="stack sm">
              <div className="row between">
                <h3 className="small bold">الزيارات</h3>
              </div>
              {data.visits_list.length === 0 ? <p className="small muted">لسه مفيش زيارات خلصت.</p> : (
                <ul className="visit-list">
                  {data.visits_list.map((visit) => (
                    <li key={visit.ticket_id}>
                      <span className="small muted">{formatDateTime(visit.finished_at)}</span>
                      <span className="grow truncate">{visit.services}{visit.barber_name && <span className="muted"> · أ. {visit.barber_name}</span>}</span>
                      <span className="num">{formatMoney(visit.bill_total ?? visit.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.loyalty_events.length > 0 && (
              <details className="small">
                <summary className="muted">حركة الأختام</summary>
                <ul className="visit-list">
                  {data.loyalty_events.map((event, index) => (
                    <li key={index}>
                      <span className="muted">{formatDateTime(event.created_at)}</span>
                      <span className="grow">{EVENT_LABELS[event.type]}{event.note && <span className="muted"> · {event.note}</span>}</span>
                      <span className="num">{event.delta > 0 ? `+${event.delta}` : event.delta}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <aside className="stack card-photos">
            <div className="row between">
              <h3 className="small bold">القصّات</h3>
              {can('cards.write') && (
                <>
                  <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={upload} />
                  <Button size="sm" icon="camera" loading={uploading} onClick={() => file.current?.click()}>ضيف صورة</Button>
                </>
              )}
            </div>
            {data.photos.length === 0 ? (
              <p className="small muted">مفيش صور لسه. الحلاق يقدر يصوّر من تابلت الكرسي بعد «خلّصت».</p>
            ) : (
              <div className="photo-grid">
                {data.photos.map((photo) => (
                  <button key={photo.id} type="button" className="photo-thumb" onClick={() => setViewing(photo)} aria-label="كبّر الصورة">
                    <AuthImage path={`/cards/${cardId}/photos/${photo.id}`} alt={`قصّة ${formatDate(String(photo.created_at).slice(0, 10))}`} />
                    <span className="small">{formatDate(String(photo.created_at).slice(0, 10))}</span>
                  </button>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}
      {stamps && data && <StampsModal card={data} onClose={() => setStamps(false)} onDone={refresh} />}
      {linking && data && <LinkCodeModal card={data} onClose={() => setLinking(false)} />}
      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={`قصّة ${formatDate(String(viewing.created_at).slice(0, 10))}${viewing.barber_name ? ` — أ. ${viewing.barber_name}` : ''}`}
          footer={<>{can('cards.write') && <Button variant="danger" icon="trash" onClick={() => removePhoto(viewing)}>امسح</Button>}<Button onClick={() => setViewing(null)}>رجوع</Button></>}>
          <AuthImage path={`/cards/${cardId}/photos/${viewing.id}`} className="photo-full" />
        </Modal>
      )}
    </Modal>
  );
}
