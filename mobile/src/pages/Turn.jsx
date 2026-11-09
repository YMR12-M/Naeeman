/**
 * ═══════════════════════════════════════════════════════════════
 *  «دوري» — شاشة واحدة كبيرة
 *
 *  الرقم جوّه مراية بقوس، وتحته بالماركر: قدّامك كام أو «دورك جه».
 *  الأفعال: «جاي» (لو المحل محتاج تأكيد)، و«وصلت؟ امسح الكود»،
 *  و«أخّرني» (وجنبه كام مرّة فاضلة)، و«ألغِ الدور».
 *  لايف من `/me/stream`، وأوّل مرّة بعد أخد الدور بنطلب الإشعارات.
 * ═══════════════════════════════════════════════════════════════
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useLive } from '../lib/live.js';
import { useDocumentTitle, useNow } from '../lib/hooks.js';
import { formatMinutes, formatMoney, formatTime, minutesSince } from '../lib/format.js';
import { Icon } from '../lib/icons.jsx';
import { lastShop } from '../lib/shop.js';
import { useToast } from '../context/ToastContext.jsx';
import { LeatherButton, MarkerNote, Mirror, TicketNumber } from '../components/brand/index.jsx';
import { Button, Empty, Loading, Notice, useConfirm } from '../components/ui/index.js';
import PushPrompt from '../components/PushPrompt.jsx';
import BillCard from '../components/BillCard.jsx';
import { AuthImage } from '../components/CardBits.jsx';

const ACTIVE = ['waiting', 'serving'];

/** الجملة الكبيرة تحت الرقم */
export function headline(ticket, now = Date.now()) {
  if (ticket.status === 'serving') return { text: `على الكرسي${ticket.barber ? ` عند أ. ${ticket.barber.name}` : ''}`, tone: 'ok' };
  if (ticket.status === 'done') return { text: 'نعيمًا ✂', tone: 'ok' };
  if (ticket.status === 'cancelled') return { text: 'الدور اتلغى', tone: 'muted' };
  if (ticket.status === 'no_show') return { text: 'الدور راح عليك', tone: 'muted' };
  if (ticket.called) {
    const left = Math.max(0, ticket.grace_minutes - minutesSince(ticket.called_at, now));
    return { text: left > 0 ? `دورك جه! تعالى خلال ${formatMinutes(left)}` : 'دورك جه! تعالى حالًا', tone: 'alert' };
  }
  if (ticket.unavailable || ticket.ahead === null) return { text: 'مستني حلاق يوصل', tone: 'muted' };
  if (ticket.ahead === 0) return { text: ticket.arrived ? 'إنت الجاي' : 'إنت الجاي — اتحرّك على المحل', tone: 'alert' };
  return { text: `قدّامك ${ticket.ahead}`, tone: '' };
}

function Ended({ ticket }) {
  const slug = ticket.shop?.slug ?? lastShop();
  return (
    <div className="stack center">
      {ticket.status === 'no_show' && <p className="muted">اتنادى عليك ومجيتش في المعاد. تقدر تاخد دور جديد.</p>}
      {ticket.status === 'done' && <p className="muted">مستنيينك المرّة الجاية.</p>}
      {slug && <Link className="btn lg" to={`/s/${slug}`}>خُد دور جديد</Link>}
    </div>
  );
}

export default function Turn() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const now = useNow(20_000);
  const [busy, setBusy] = useState(null);
  const [streaming, setStreaming] = useState(false);

  // من غير رقم: الدور الشغّال. برقم: الدور ده (حتى لو خلص، من إشعار قديم مثلًا).
  // الـ stream بيبعت الدور الشغّال بس (واحد لكل زبون)، فبيتفتح طول ما الدور ده شغّال.
  const live = useLive({
    path: streaming ? '/me/stream' : null,
    load: () => (id ? api.get(`/me/tickets/${id}`) : api.get('/me/tickets/active')),
  });
  const view = live.data;
  const ticket = view?.ticket && (!id || String(view.ticket.id) === String(id)) ? view.ticket : null;
  useDocumentTitle(ticket ? `دوري — رقم ${ticket.number}` : 'دوري');

  useEffect(() => {
    setStreaming(Boolean(ticket && ACTIVE.includes(ticket.status)));
    if (ticket) queryClient.setQueryData(['active-ticket'], ACTIVE.includes(ticket.status) ? { ticket } : { ticket: null });
  }, [ticket, queryClient]);

  if (!view) {
    if (live.error?.code === 'TICKET_NOT_FOUND') return <Navigate to="/turn" replace />;
    return live.error ? <Notice tone="danger" icon="alert">{live.error.message}</Notice> : <Loading label="بنجيب دورك…" />;
  }

  if (!ticket) {
    const slug = lastShop();
    return (
      <Mirror className="page-card">
        <Empty icon="hourglass" title="معاكش دور دلوقتي">
          {slug ? 'خُد دور من صفحة المحل، وتابعه من هنا.' : 'امسح الـ QR اللي على شاشة المحل عشان تاخد دور.'}
        </Empty>
        <div className="row center">{slug ? <Link className="leather" to={`/s/${slug}`}>صفحة المحل</Link> : <Link className="btn" to="/">الرئيسية</Link>}</div>
      </Mirror>
    );
  }

  const active = ACTIVE.includes(ticket.status);
  const waiting = ticket.status === 'waiting';
  const line = headline(ticket, now);
  const showComing = waiting && !ticket.arrived && !ticket.confirmed && (ticket.must_confirm || ticket.called);

  async function act(label, path, success) {
    setBusy(label);
    try {
      live.setData(await api.act(`/me/tickets/${ticket.id}/${path}`));
      if (success) toast.success(success);
    } catch (failure) {
      toast.error(failure.message);
      live.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function delay() {
    const answer = await confirm({
      title: 'أخّرني خطوتين؟',
      message: `الدور هيرجع ورا اتنين. فاضلك ${ticket.delays_left} ${ticket.delays_left === 1 ? 'مرّة' : 'مرّات'}.`,
      confirmLabel: 'أخّرني',
    });
    if (answer) act('delay', 'delay', 'رجعت خطوتين');
  }

  async function cancel() {
    const answer = await confirm({ title: 'تلغي الدور؟', message: 'الدور هيروح، ولو رجعت هتاخد رقم جديد في آخر الطابور.', confirmLabel: 'ألغِ الدور', danger: true });
    if (answer) {
      await act('cancel', 'cancel', 'الدور اتلغى');
      queryClient.setQueryData(['active-ticket'], { ticket: null });
    }
  }

  return (
    <div className="stack lg turn">
      <div className="row between">
        <Link to={`/s/${ticket.shop.slug}`} className="bold">{ticket.shop.name}</Link>
        {active && <span className={`live-dot ${live.status}`}>{live.status === 'live' ? 'لايف' : 'بيتصل…'}</span>}
      </div>

      <Mirror arch className={`turn-mirror ${line.tone}`} flashKey={`${ticket.status}-${ticket.ahead}-${ticket.called}`}>
        <span className="muted">رقم دورك</span>
        <TicketNumber value={ticket.number} size="clamp(5rem, 30vw, 8rem)" />
        <MarkerNote value={line.text} className="turn-line">{line.text}</MarkerNote>
        {waiting && ticket.wait_minutes !== null && ticket.ahead !== 0 && !ticket.called && (
          <span className="small">الوقت المتوقّع حوالي {formatMinutes(ticket.wait_minutes)}</span>
        )}
        {waiting && ticket.arrived && <span className="badge ok"><Icon name="check" size={14} /> وصلت المحل</span>}
        {ticket.preferred_barber && waiting && <span className="small muted">مستني أ. {ticket.preferred_barber.name}</span>}
      </Mirror>

      {location.search.includes('new=1') && active && <PushPrompt />}

      {active && (
        <div className="stack">
          {showComing && (
            <LeatherButton block loading={busy === 'coming'} disabled={Boolean(busy)} onClick={() => act('coming', 'coming', 'المحل عرف إنك جاي')}>
              جاي
            </LeatherButton>
          )}
          {ticket.must_confirm && !ticket.confirmed && (
            <Notice icon="info">دوس «جاي» عشان الدور ما يتلغيش — المحل محتاج يتأكد إنك جاي.</Notice>
          )}
          {waiting && !ticket.arrived && (
            <Link className={`btn lg block ${showComing ? '' : 'primary'}`.trim()} to={`/checkin/${ticket.shop.slug}`}>
              <Icon name="qr" size={20} />وصلت؟ امسح الكود
            </Link>
          )}
          {waiting && (
            <div className="row">
              <Button className="grow" disabled={Boolean(busy) || ticket.delays_left === 0} onClick={delay} icon="hourglass">
                أخّرني {ticket.delays_left > 0 ? <span className="small muted">(فاضل <span className="num">{ticket.delays_left}</span>)</span> : <span className="small muted">(خلصت)</span>}
              </Button>
              <Button className="grow" variant="ghost" disabled={Boolean(busy)} onClick={cancel} icon="close">ألغِ الدور</Button>
            </div>
          )}
          {ticket.status === 'serving' && ticket.started_at && (
            <p className="small center muted">قعدت الساعة {formatTime(ticket.started_at)}</p>
          )}
        </div>
      )}

      {!active && <Ended ticket={ticket} />}

      <Mirror thin className="stack sm page-card">
        <span className="small muted">طلبت</span>
        <span>{ticket.services.map((service) => service.name).join(' + ')}</span>
        {!active && ticket.status === 'done' && !ticket.bill && <span className="small">الحساب <span className="num bold">{formatMoney(ticket.total)}</span></span>}
      </Mirror>

      <BillCard bill={ticket.bill} />

      {ticket.photo_ids?.length > 0 && (
        <Mirror thin className="stack sm page-card">
          <h2>قصّتك</h2>
          <div className="photo-grid">
            {ticket.photo_ids.map((photoId) => <AuthImage key={photoId} path={`/me/photos/${photoId}`} alt="قصّتك" />)}
          </div>
        </Mirror>
      )}

      {!id && active && <Button variant="ghost" onClick={() => navigate('/history')}>سجلّي</Button>}
    </div>
  );
}
