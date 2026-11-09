/**
 * ═══════════════════════════════════════════════════════════════
 *  الطابور — الشاشة الرئيسية للوحة
 *
 *  عمود لكل حلاق موجود (مراية مستطيلة طويلة): اللي على الكرسي بعدّاد،
 *  وتحته اللي طالبينه بالاسم. وعمود «أي حد» للي مش فارق معاه، وجنب كل
 *  دور الحلاق المتوقّع. الحلاقين «مش موجودين» في سطر تحت.
 *
 *  الزرار الجلد الوحيد في الشاشة: «زبون من الشارع» (ده شغل الاستقبال
 *  الأساسي؛ «التالي» شغل تابلت الكرسي، وهنا زرار عادي للطوارئ).
 *  الصورة لايف من الـ stream، وأي فعل بيروح بمفتاح منع تكرار.
 * ═══════════════════════════════════════════════════════════════
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useLive } from '../lib/live.js';
import { useDocumentTitle, useNow } from '../lib/hooks.js';
import { Icon } from '../lib/icons.jsx';
import {
  BARBER_STATUS_LABELS, SOURCE_LABELS, etaLabel, formatMoney, minutesSince, whatsappLink,
} from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Button, Empty, Field, Input, Loading, Menu, MenuItem, Modal, Notice, Select, Switch, useConfirm,
} from '../components/ui/index.js';
import {
  LeatherButton, MarkerNote, Mirror, OpenSign, Portrait, PriceRow, Sign, TicketNumber,
} from '../components/brand/index.jsx';
import RecoveryCodeModal from '../components/shop/RecoveryCodeModal.jsx';
import BillModal from '../components/shop/BillModal.jsx';
import CardModal from '../components/shop/CardModal.jsx';

const errorText = (error) => error?.message ?? 'حصل خطأ غير متوقّع';

/* ═══════════════════ سطر دور في الطابور ═══════════════════ */

function TicketFlags({ ticket }) {
  return (
    <span className="ticket-flags">
      {ticket.arrived
        ? <MarkerNote flat ok>وصل ✓</MarkerNote>
        : ticket.called_at
          ? <MarkerNote flat>اتنادى ومستني</MarkerNote>
          : <span className="badge marker">{SOURCE_LABELS[ticket.source]}</span>}
      {ticket.delays_used > 0 && <span className="badge">أخّر {ticket.delays_used}</span>}
      {ticket.trust_confirm_required && !ticket.confirmed && <span className="badge warn">لازم يأكّد</span>}
      {ticket.card?.loyalty?.eligible && <span className="badge ok" title={ticket.card.loyalty.reward}>مكافأة ★</span>}
      {ticket.card?.notes && <span className="badge" title={ticket.card.notes}><Icon name="edit" size={12} /> ملاحظة</span>}
    </span>
  );
}

function TicketLine({ ticket, barbersById, onAction, can, showExpected }) {
  const expected = showExpected && ticket.expected_barber_id ? barbersById.get(ticket.expected_barber_id) : null;
  return (
    <li className={`ticket-line ${ticket.called_at && !ticket.arrived ? 'is-called' : ''}`.trim()}>
      <TicketNumber value={ticket.number} size="1.9rem" />
      <div className="grow">
        <div className="row tight wrap">
          <span className="bold truncate">{ticket.name}</span>
          <TicketFlags ticket={ticket} />
        </div>
        <div className="small muted truncate">
          {ticket.services.map((service) => service.name).join(' + ')}
          {' · '}
          {ticket.unavailable ? 'الحلاق مش موجود' : etaLabel(ticket.eta)}
          {expected && <> · لـ {expected.name}</>}
        </div>
      </div>
      <Menu trigger={<Button variant="ghost" size="sm" icon="more" aria-label={`أفعال رقم ${ticket.number}`} />}>
        {!ticket.arrived && <MenuItem icon="check" onClick={() => onAction('arrive', ticket)}>وصل</MenuItem>}
        <MenuItem icon="swap" onClick={() => onAction('assign', ticket)}>غيّر الحلاق</MenuItem>
        <MenuItem icon="plus" onClick={() => onAction('service', ticket)}>زوّد خدمة</MenuItem>
        {can('queue.manage') && <MenuItem icon="list" onClick={() => onAction('move', ticket)}>حرّك في الطابور</MenuItem>}
        {can('billing.use') && <MenuItem icon="tag" onClick={() => onAction('bill', ticket)}>بيع منتج / الفاتورة</MenuItem>}
        {ticket.card && can('cards.read') && <MenuItem icon="user" onClick={() => onAction('card', ticket)}>كارت الزبون</MenuItem>}
        {ticket.phone && (
          <a href={whatsappLink(ticket.phone, `أهلًا ${ticket.name}، دورك رقم ${ticket.number}.`)} target="_blank" rel="noreferrer" role="menuitem">
            <Icon name="whatsapp" size={16} />ابعت واتساب
          </a>
        )}
        <hr />
        <MenuItem icon="ban" onClick={() => onAction('no-show', ticket)}>ما جاش</MenuItem>
        <MenuItem icon="close" danger onClick={() => onAction('cancel', ticket)}>ألغِ الدور</MenuItem>
      </Menu>
    </li>
  );
}

/* ═══════════════════ عمود حلاق ═══════════════════ */

function ServingCard({ ticket, now, onAction, can }) {
  const elapsed = minutesSince(ticket.started_at, now);
  return (
    <div className="serving">
      <div className="row between">
        <span className="small muted">على الكرسي</span>
        <MarkerNote value={elapsed}>بقاله {elapsed} د</MarkerNote>
      </div>
      <div className="row">
        <TicketNumber value={ticket.number} size="2.6rem" />
        <div className="grow">
          <div className="bold truncate">{ticket.name}</div>
          <div className="small muted truncate">{ticket.services.map((service) => service.name).join(' + ')}</div>
        </div>
        <Menu trigger={<Button variant="ghost" size="sm" icon="more" aria-label="أفعال الزبون اللي على الكرسي" />}>
          <MenuItem icon="plus" onClick={() => onAction('service', ticket)}>زوّد خدمة</MenuItem>
          {can?.('billing.use') && <MenuItem icon="tag" onClick={() => onAction('bill', ticket)}>بيع منتج / الفاتورة</MenuItem>}
          {ticket.card && can?.('cards.read') && <MenuItem icon="user" onClick={() => onAction('card', ticket)}>كارت الزبون</MenuItem>}
          <MenuItem icon="close" danger onClick={() => onAction('cancel', ticket)}>ألغِ (بسبب)</MenuItem>
        </Menu>
      </div>
      {ticket.card?.notes && <p className="small serving-note"><Icon name="edit" size={13} /> {ticket.card.notes}</p>}
    </div>
  );
}

function BarberColumn({ barber, tickets, now, barbersById, onAction, onBarber, can, busy }) {
  return (
    <Mirror as="section" className="lane" aria-label={`طابور ${barber.name}`}>
      <header className="lane-head">
        <Portrait name={barber.name} src={barber.photo_path} />
        <div className="grow">
          <div className="bold truncate">{barber.name}{barber.chair_no ? <span className="muted small"> · كرسي <span className="num">{barber.chair_no}</span></span> : null}</div>
          <span className={`badge ${barber.status === 'available' ? 'ok' : 'warn'}`}>{BARBER_STATUS_LABELS[barber.status]}</span>
        </div>
        {can('barbers.status') && (
          <Menu trigger={<Button variant="ghost" size="sm" icon="more" aria-label={`حالة ${barber.name}`} />}>
            {barber.status !== 'available' && <MenuItem icon="check" onClick={() => onBarber(barber, 'available')}>رجع (متاح)</MenuItem>}
            {barber.status !== 'break' && <MenuItem icon="coffee" onClick={() => onBarber(barber, 'break')}>استراحة ربع ساعة</MenuItem>}
            <MenuItem icon="logout" onClick={() => onBarber(barber, 'off')}>مش موجود النهارده</MenuItem>
          </Menu>
        )}
      </header>

      {barber.serving
        ? <ServingCard ticket={barber.serving} now={now} onAction={onAction} can={can} />
        : <div className="serving empty-chair"><MarkerNote>الكرسي فاضي</MarkerNote></div>}

      {can('queue.write') && (
        <div className="lane-actions">
          <Button size="sm" icon="next" loading={busy === `next-${barber.id}`} onClick={() => onBarber(barber, 'next')}>التالي</Button>
          {barber.serving && <Button size="sm" variant="ghost" icon="check" loading={busy === `finish-${barber.id}`} onClick={() => onBarber(barber, 'finish')}>خلّص</Button>}
        </div>
      )}

      <div className="lane-list-head small muted">طالبينه بالاسم <span className="num">{tickets.length}</span></div>
      {tickets.length === 0
        ? <p className="small muted lane-none">مفيش</p>
        : (
          <ol className="ticket-list">
            {tickets.map((ticket) => (
              <TicketLine key={ticket.id} ticket={ticket} barbersById={barbersById} onAction={onAction} can={can} />
            ))}
          </ol>
        )}
    </Mirror>
  );
}

/* ═══════════════════ النوافذ ═══════════════════ */

function ServicePicker({ services, selected, onToggle }) {
  return (
    <div className="service-picker" role="group" aria-label="الخدمات">
      {services.map((service) => {
        const on = selected.includes(service.id);
        return (
          <button key={service.id} type="button" className={`service-pick ${on ? 'on' : ''}`.trim()} aria-pressed={on} onClick={() => onToggle(service.id)}>
            <PriceRow name={<span className="row tight">{on ? <Icon name="check" size={16} /> : <span className="pick-box" />}{service.name}</span>} price={service.price} />
          </button>
        );
      })}
    </div>
  );
}

function WalkInModal({ open, onClose, services, barbers, onDone }) {
  const toast = useToast();
  const [selected, setSelected] = useState([]);
  const [barberId, setBarberId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => { setSelected([]); setBarberId(''); setName(''); setPhone(''); setError(null); };
  const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const total = services.filter((service) => selected.includes(service.id)).reduce((sum, service) => sum + service.price, 0);

  async function submit(event) {
    event.preventDefault();
    if (selected.length === 0) { setError('اختار خدمة واحدة على الأقل'); return; }
    setBusy(true);
    setError(null);
    try {
      const ticket = await api.act('/queue/tickets', {
        service_ids: selected, barber_id: barberId ? Number(barberId) : null, name: name.trim() || null, phone: phone.trim() || null,
      });
      toast.success(`اتسجّل — رقم ${ticket.number}`);
      reset();
      onDone();
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="زبون من الشارع"
      footer={(
        <>
          <span className="grow small muted">الإجمالي <span className="num bold">{formatMoney(total)}</span></span>
          <Button onClick={onClose}>رجوع</Button>
          <LeatherButton type="submit" form="walk-in" loading={busy}>سجّل الدور</LeatherButton>
        </>
      )}
    >
      <form id="walk-in" className="stack" onSubmit={submit} noValidate>
        {error && <Notice tone="danger" icon="alert">{error}</Notice>}
        <ServicePicker services={services} selected={selected} onToggle={toggle} />
        <div className="grid cols-2">
          <Field label="الحلاق">
            {(props) => (
              <Select {...props} value={barberId} onChange={(event) => setBarberId(event.target.value)}>
                <option value="">أي حد فاضي</option>
                {barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="الاسم" hint="اختياري — من غيره بيظهر «زبون»">
            {(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />}
          </Field>
        </div>
        <Field label="الموبايل" hint="اختياري — عشان تبعتله واتساب لما دوره يقرّب">
          {(props) => <Input {...props} type="tel" dir="ltr" className="ltr-input" value={phone} onChange={(event) => setPhone(event.target.value)} />}
        </Field>
      </form>
    </Modal>
  );
}

function AssignModal({ ticket, barbers, onClose, onDone }) {
  const [value, setValue] = useState(ticket?.preferred_barber_id ? String(ticket.preferred_barber_id) : '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!ticket) return null;
  async function save() {
    setBusy(true);
    try {
      await api.act(`/queue/tickets/${ticket.id}/assign`, { barber_id: value ? Number(value) : null });
      onDone();
      onClose();
    } catch (failure) {
      toast.error(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`حلاق رقم ${ticket.number}`} size="narrow"
      footer={<><Button onClick={onClose}>رجوع</Button><Button variant="primary" loading={busy} onClick={save}>حفظ</Button></>}>
      <Field label="الحلاق">
        {(props) => (
          <Select {...props} value={value} onChange={(event) => setValue(event.target.value)}>
            <option value="">أي حد فاضي</option>
            {barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}
          </Select>
        )}
      </Field>
    </Modal>
  );
}

function AddServiceModal({ ticket, services, onClose, onDone }) {
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  if (!ticket) return null;
  async function add(service) {
    setBusy(service.id);
    try {
      await api.act(`/queue/tickets/${ticket.id}/services`, { service_id: service.id });
      toast.success(`اتزوّد «${service.name}» لرقم ${ticket.number}`);
      onDone();
      onClose();
    } catch (failure) {
      toast.error(errorText(failure));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal open onClose={onClose} title={`زوّد خدمة لرقم ${ticket.number}`} size="narrow">
      <div className="service-picker">
        {services.map((service) => (
          <button key={service.id} type="button" className="service-pick" disabled={busy !== null} onClick={() => add(service)}>
            <PriceRow name={service.name} price={service.price} />
          </button>
        ))}
      </div>
    </Modal>
  );
}

function MoveModal({ ticket, waiting, onClose, onDone }) {
  const [after, setAfter] = useState('top');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!ticket) return null;
  const others = waiting.filter((item) => item.id !== ticket.id);
  async function save() {
    setBusy(true);
    try {
      await api.act(`/queue/tickets/${ticket.id}/move`, { after_ticket_id: after === 'top' ? null : Number(after), reason: reason.trim() });
      onDone();
      onClose();
    } catch (failure) {
      toast.error(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`حرّك رقم ${ticket.number}`} size="narrow"
      footer={<><Button onClick={onClose}>رجوع</Button><Button variant="primary" loading={busy} disabled={reason.trim().length < 2} onClick={save}>حرّك</Button></>}>
      <div className="stack">
        <Field label="يبقى">
          {(props) => (
            <Select {...props} value={after} onChange={(event) => setAfter(event.target.value)}>
              <option value="top">أوّل الطابور</option>
              {others.map((item) => <option key={item.id} value={item.id}>بعد رقم {item.number} ({item.name})</option>)}
            </Select>
          )}
        </Field>
        <Field label="السبب" required hint="بيتسجّل في السجل">
          {(props) => <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={190} />}
        </Field>
      </div>
    </Modal>
  );
}

/* ═══════════════════ الصفحة ═══════════════════ */

export default function Queue() {
  useDocumentTitle('الطابور');
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const now = useNow(15_000);
  const live = useLive({ path: '/queue/stream', load: () => api.get('/queue') });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get('/services') });
  const [walkIn, setWalkIn] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(null);

  const queue = live.data;
  const activeServices = useMemo(() => (services.data ?? []).filter((service) => service.active), [services.data]);
  const barbersById = useMemo(() => new Map((queue?.barbers ?? []).map((barber) => [barber.id, barber])), [queue]);
  const present = (queue?.barbers ?? []).filter((barber) => barber.status !== 'off' || barber.serving);
  const absent = (queue?.barbers ?? []).filter((barber) => barber.status === 'off' && !barber.serving);
  const waiting = queue?.waiting ?? [];
  const anyone = waiting.filter((ticket) => !ticket.preferred_barber_id || !barbersById.has(ticket.preferred_barber_id) || barbersById.get(ticket.preferred_barber_id).status === 'off');

  async function run(label, action, success) {
    setBusy(label);
    try {
      await action();
      if (success) toast.success(success);
      live.refresh();
    } catch (failure) {
      toast.error(errorText(failure));
    } finally {
      setBusy(null);
    }
  }

  async function onAction(kind, ticket) {
    if (kind === 'arrive') return run(`arrive-${ticket.id}`, () => api.act(`/queue/tickets/${ticket.id}/arrive`), `رقم ${ticket.number} وصل`);
    if (['assign', 'service', 'move', 'bill', 'card'].includes(kind)) return setDialog({ kind, ticket });
    if (kind === 'no-show') {
      const answer = await confirm({ title: `رقم ${ticket.number} ما جاش؟`, message: 'الدور هيتقفل ويتسجّل إنه ما جاش.', confirmLabel: 'ما جاش', danger: true });
      if (answer) run('no-show', () => api.act(`/queue/tickets/${ticket.id}/no-show`));
      return undefined;
    }
    if (kind === 'cancel') {
      const serving = ticket.status === 'serving';
      const answer = await confirm({
        title: `إلغاء رقم ${ticket.number}`,
        message: serving ? 'الزبون على الكرسي — الإلغاء محتاج سبب.' : 'لو الزبون من التطبيق هيوصله إشعار.',
        confirmLabel: 'ألغِ الدور',
        danger: true,
        reason: { label: 'السبب', required: serving },
      });
      if (answer) run('cancel', () => api.act(`/queue/tickets/${ticket.id}/cancel`, { reason: answer.reason || null }), 'الدور اتلغى');
    }
    return undefined;
  }

  async function onBarber(barber, kind) {
    if (kind === 'next') return run(`next-${barber.id}`, () => api.act(`/queue/barbers/${barber.id}/next`));
    if (kind === 'finish') return run(`finish-${barber.id}`, () => api.act(`/queue/barbers/${barber.id}/finish`));
    return run(`status-${barber.id}`, async () => {
      await api.post(`/barbers/${barber.id}/status`, { status: kind, ...(kind === 'break' ? { break_minutes: 15 } : {}) });
      queryClient.invalidateQueries({ queryKey: ['barbers'] });
    });
  }

  async function toggleAccepting(value) {
    await run('accepting', () => api.patch('/shop', { accepting_tickets: value }), value ? 'المحل بياخد أدوار' : 'الأدوار اتوقّفت');
    queryClient.invalidateQueries({ queryKey: ['shop'] });
  }

  if (!queue) return live.error ? <Notice tone="danger" icon="alert">{errorText(live.error)}</Notice> : <Loading label="بنجيب الطابور…" />;

  return (
    <div className="stack lg">
      <div className="page-head">
        <div className="row wrap">
          <Sign as="h1">الطابور</Sign>
          <OpenSign open={queue.open.open} />
          <span className={`live-dot ${live.status}`} title={live.status === 'live' ? 'لايف' : 'بيحاول يتصل'}>
            {live.status === 'live' ? 'لايف' : 'بيتصل…'}
          </span>
        </div>
        <div className="tools">
          {can('shop.write') && (
            <Switch checked={queue.accepting_tickets} onChange={toggleAccepting} label="بياخد أدوار" disabled={busy === 'accepting'} />
          )}
          {can('queue.write') && (
            <Button variant="ghost" icon="key" onClick={() => setRecovery(true)}>زبون نسي كلمة السر</Button>
          )}
          {can('queue.write') && (
            <LeatherButton onClick={() => setWalkIn(true)} disabled={activeServices.length === 0}>
              <Icon name="user-plus" size={18} />زبون من الشارع
            </LeatherButton>
          )}
        </div>
      </div>

      {!queue.accepting_tickets && <Notice icon="ban">المحل موقّف الأدوار — التطبيق وتابلت الباب مش هياخدوا أدوار لحد ما ترجّعها.</Notice>}

      <div className="queue-summary small">
        <span>مستنيين <span className="num bold">{waiting.length}</span></span>
        <span>على الكراسي <span className="num bold">{present.filter((barber) => barber.serving).length}</span></span>
        <span>حلاقين شغّالين <span className="num bold">{present.filter((barber) => barber.status === 'available').length}</span></span>
      </div>

      {present.length === 0 && waiting.length === 0 ? (
        <Mirror>
          <Empty icon="chair" title="المحل هادي">
            مفيش حلاقين شغّالين ولا أدوار. الحلاق بيبقى «متاح» لما يدخل على تابلت الكرسي، أو من صفحة الحلاقين.
          </Empty>
        </Mirror>
      ) : (
        <div className="board">
          {present.map((barber) => (
            <BarberColumn
              key={barber.id}
              barber={barber}
              tickets={waiting.filter((ticket) => ticket.preferred_barber_id === barber.id)}
              now={now}
              barbersById={barbersById}
              onAction={onAction}
              onBarber={onBarber}
              can={can}
              busy={busy}
            />
          ))}
          <Mirror as="section" className="lane anyone" aria-label="أي حد">
            <header className="lane-head">
              <span className="anyone-mark" aria-hidden="true"><Icon name="users" size={24} /></span>
              <div className="grow">
                <div className="bold">أي حد فاضي</div>
                <span className="small muted">بالترتيب، والحلاق المتوقّع جنب كل دور</span>
              </div>
            </header>
            {anyone.length === 0
              ? <p className="small muted lane-none">مفيش</p>
              : (
                <ol className="ticket-list">
                  {anyone.map((ticket) => (
                    <TicketLine key={ticket.id} ticket={ticket} barbersById={barbersById} onAction={onAction} can={can} showExpected />
                  ))}
                </ol>
              )}
          </Mirror>
        </div>
      )}

      {absent.length > 0 && (
        <div className="absent row wrap small">
          <span className="muted">مش موجودين النهارده:</span>
          {absent.map((barber) => (
            <span key={barber.id} className="row tight">
              <span>{barber.name}</span>
              {can('barbers.status') && <Button size="sm" variant="ghost" onClick={() => onBarber(barber, 'available')}>رجّعه</Button>}
            </span>
          ))}
        </div>
      )}

      <RecoveryCodeModal open={recovery} onClose={() => setRecovery(false)} />
      <WalkInModal open={walkIn} onClose={() => setWalkIn(false)} services={activeServices} barbers={present.filter((barber) => barber.status !== 'off')} onDone={live.refresh} />
      {dialog?.kind === 'assign' && <AssignModal ticket={dialog.ticket} barbers={present.filter((barber) => barber.status !== 'off')} onClose={() => setDialog(null)} onDone={live.refresh} />}
      {dialog?.kind === 'service' && <AddServiceModal ticket={dialog.ticket} services={activeServices} onClose={() => setDialog(null)} onDone={live.refresh} />}
      {dialog?.kind === 'move' && <MoveModal ticket={dialog.ticket} waiting={waiting} onClose={() => setDialog(null)} onDone={live.refresh} />}
      {dialog?.kind === 'bill' && <BillModal ticketId={dialog.ticket.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'card' && <CardModal cardId={dialog.ticket.card.id} onClose={() => setDialog(null)} />}
    </div>
  );
}

