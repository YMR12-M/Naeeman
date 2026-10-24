/**
 * ═══════════════════════════════════════════════════════════════
 *  تابلت الكرسي — شغل الحلاق كله زرار واحد
 *
 *  أوّل الوردية: يختار اسمه ويكتب الـ PIN. بعدها: يافطة فيها رقم الكرسي
 *  واسمه، ومراية للزبون اللي على الكرسي، ومراية فيها «الجايين» بالماركر،
 *  وزرار «التالي» جلد ماسك تلت الشاشة. الباقي على البلاط تحت.
 * ═══════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useState } from 'react';
import { deviceAct, deviceHeaders, deviceRequest } from '../lib/device.js';
import { useLive } from '../lib/live.js';
import { useNow } from '../lib/hooks.js';
import { formatMinutes, minutesSince } from '../lib/format.js';
import { Icon } from '../lib/icons.jsx';
import {
  LeatherButton, MarkerNote, Mirror, Portrait, PriceRow, Sign, TicketNumber,
} from '../components/brand/index.jsx';
import { Loading, Modal, Notice } from '../components/ui/index.js';
import DeviceGate, { useDevice } from './DeviceGate.jsx';

/* ── أوّل الوردية: الاسم ثم الـ PIN ── */
function SignIn({ onSignedIn }) {
  const { unpair } = useDevice();
  const [barbers, setBarbers] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    deviceRequest('chair', '/chair/barbers')
      .then((data) => setBarbers(data.barbers))
      .catch((failure) => (failure.status === 401 ? unpair() : setError(failure.message)));
  }, [unpair]);

  const press = (digit) => setPin((current) => (current.length < 4 ? current + digit : current));

  useEffect(() => {
    if (pin.length !== 4 || !chosen) return;
    setBusy(true);
    setError(null);
    deviceAct('chair', '/chair/login', { barber_id: chosen.id, pin })
      .then(onSignedIn)
      .catch((failure) => { setError(failure.message); setPin(''); })
      .finally(() => setBusy(false));
  }, [pin, chosen, onSignedIn]);

  if (!barbers) return error ? <Notice tone="danger" icon="alert">{error}</Notice> : <Loading />;

  if (!chosen) {
    return (
      <div className="chair-signin">
        <h1 className="chair-title">مين على الكرسي؟</h1>
        <div className="chair-names">
          {barbers.map((barber) => (
            <button key={barber.id} type="button" className="chair-name" disabled={!barber.has_pin || barber.locked} onClick={() => setChosen(barber)}>
              <Portrait name={barber.name} large />
              <span className="bold">أ. {barber.name}</span>
              {!barber.has_pin && <span className="small muted">محتاج PIN من المالك</span>}
              {barber.locked && <span className="small muted">مقفول دلوقتي</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="chair-signin">
      {/* «الـ PIN» في آخر السطر كانت بتتقلب (الكلمة اللاتيني بتشد «الـ» لناحيتها) */}
      <h1 className="chair-title">أهلًا أ. {chosen.name} — اكتب الرقم السرّي</h1>
      <div className="pin-dots" aria-label={`اتكتب ${pin.length} من 4`}>
        {[0, 1, 2, 3].map((index) => <span key={index} className={index < pin.length ? 'on' : ''} />)}
      </div>
      {error && <Notice tone="danger" icon="alert">{error}</Notice>}
      <div className="pin-pad" dir="ltr">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button key={digit} type="button" className="pin-key" disabled={busy} onClick={() => press(digit)}>{digit}</button>
        ))}
        <button type="button" className="pin-key ghost" onClick={() => { setChosen(null); setPin(''); setError(null); }} aria-label="رجوع"><Icon name="arrow-left" size={28} /></button>
        <button type="button" className="pin-key" disabled={busy} onClick={() => press('0')}>0</button>
        <button type="button" className="pin-key ghost" onClick={() => setPin((current) => current.slice(0, -1))} aria-label="امسح"><Icon name="close" size={28} /></button>
      </div>
    </div>
  );
}

/* ── الوردية ── */
function Station({ onSignedOut }) {
  const now = useNow(20_000);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const live = useLive({
    path: '/chair/stream',
    load: () => deviceRequest('chair', '/chair/queue'),
    headers: async () => deviceHeaders('chair'),
    onFatal: () => onSignedOut(),
  });

  const act = useCallback(async (label, path, body) => {
    setBusy(label);
    setError(null);
    try {
      const result = await deviceAct('chair', path, body);
      live.setData(result?.view ?? result);
    } catch (failure) {
      if (failure.code === 'CHAIR_SIGNED_OUT') onSignedOut();
      else setError(failure.message);
    } finally {
      setBusy(null);
    }
  }, [live, onSignedOut]);

  useEffect(() => {
    if (live.error?.code === 'CHAIR_SIGNED_OUT') onSignedOut();
  }, [live.error, onSignedOut]);

  const view = live.data;
  if (!view) return <Loading />;
  const { barber, serving } = view;
  const elapsed = serving ? minutesSince(serving.started_at, now) : 0;
  const onBreak = barber.status === 'break';

  return (
    <div className="chair">
      <header className="chair-head">
        <Sign>{barber.chair_no ? `كرسي ${barber.chair_no} · ` : ''}أ. {barber.name}</Sign>
        {serving && <MarkerNote value={elapsed} className="chair-elapsed">{elapsed === 0 ? 'لسه قاعد' : `بقالك ${formatMinutes(elapsed)}`}</MarkerNote>}
        {onBreak && <MarkerNote className="chair-elapsed">في الاستراحة</MarkerNote>}
      </header>

      {error && <Notice tone="danger" icon="alert">{error}</Notice>}

      <div className="chair-mirrors">
        <Mirror className="chair-now" flashKey={serving?.id}>
          <span className="muted">على الكرسي دلوقتي</span>
          {serving ? (
            <>
              <div className="row">
                <TicketNumber value={serving.number} size="clamp(3rem, 8vw, 5rem)" />
                <div className="stack sm">
                  <span className="chair-customer">{serving.name}</span>
                  <span className="muted">{serving.services.join(' + ')}</span>
                </div>
              </div>
              <span className="small muted">المتوقّع حوالي {formatMinutes(serving.expected_minutes)}</span>
            </>
          ) : <MarkerNote className="chair-empty">الكرسي فاضي</MarkerNote>}
        </Mirror>
        <Mirror thin className="chair-next">
          <span className="muted">الجايين عندك (<span className="num">{view.waiting_for_me}</span>)</span>
          {view.next.length === 0 ? <MarkerNote>مفيش حد</MarkerNote> : view.next.map((ticket) => (
            <MarkerNote flat key={ticket.id} className="chair-next-line">
              <span className="num">{ticket.number}</span> {ticket.name} {ticket.arrived ? '✓ وصل' : ticket.called ? '← اتنادى' : '· لسه ما وصلش'}
            </MarkerNote>
          ))}
        </Mirror>
      </div>

      {/* مقفول طول ما فيه فعل تاني شغّال: دوستين ورا بعض = زبونين اتنادوا */}
      <LeatherButton giant block loading={busy === 'next'} disabled={Boolean(busy)} onClick={() => act('next', '/chair/next')}>
        التالي
      </LeatherButton>

      <footer className="tiles chair-floor">
        <button type="button" className="btn lg" disabled={!serving || busy} onClick={() => setAdding(true)}><Icon name="plus" />خدمة</button>
        <button type="button" className="btn lg" disabled={!serving || busy} onClick={() => act('finish', '/chair/finish')}><Icon name="check" />خلّصت</button>
        {onBreak
          ? <button type="button" className="btn lg" disabled={busy} onClick={() => act('status', '/chair/status', { status: 'available' })}><Icon name="arrow-right" />رجعت</button>
          : <button type="button" className="btn lg" disabled={busy || Boolean(serving)} onClick={() => act('status', '/chair/status', { status: 'break', break_minutes: 15 })}><Icon name="coffee" />استراحة</button>}
        <button type="button" className="btn lg ghost" disabled={busy} onClick={async () => { await deviceAct('chair', '/chair/logout').catch(() => {}); onSignedOut(); }}><Icon name="logout" />خروج</button>
      </footer>

      {adding && (
        <Modal open onClose={() => setAdding(false)} title={`زوّد خدمة لرقم ${serving?.number ?? ''}`} size="narrow">
          <div className="service-picker">
            {view.services.map((service) => (
              <button key={service.id} type="button" className="service-pick" onClick={() => { setAdding(false); act('service', '/chair/services', { service_id: service.id }); }}>
                <PriceRow name={service.name} price={service.price} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ChairScreen() {
  const [signedIn, setSignedIn] = useState(null);
  useEffect(() => {
    deviceRequest('chair', '/chair/barbers')
      .then((data) => setSignedIn(Boolean(data.current_barber_id)))
      .catch(() => setSignedIn(false));
  }, []);
  const signOut = useCallback(() => setSignedIn(false), []);
  const signIn = useCallback(() => setSignedIn(true), []);

  if (signedIn === null) return <Loading />;
  return signedIn ? <Station onSignedOut={signOut} /> : <SignIn onSignedIn={signIn} />;
}

export default function Chair() {
  return <DeviceGate type="chair" label="تابلت الكرسي"><ChairScreen /></DeviceGate>;
}
