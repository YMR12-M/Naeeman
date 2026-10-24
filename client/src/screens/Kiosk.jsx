/**
 * ═══════════════════════════════════════════════════════════════
 *  تابلت الباب — الزبون اللي داخل من الشارع ياخد دوره في 3 لمسات
 *
 *  1) الخدمات من قايمة الأسعار نفسها  2) الحلاق أو «أي حد»  3) الاسم
 *  (والموبايل اختياري). وفي الآخر الرقم كبير جوّه مراية، والشاشة بترجع
 *  لأوّلها لوحدها بعد 15 ثانية. «غلطت؟» بيلغي الدور خلال دقيقة.
 * ═══════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { deviceAct, deviceRequest } from '../lib/device.js';
import { formatMinutes, formatMoney } from '../lib/format.js';
import { Icon } from '../lib/icons.jsx';
import {
  LeatherButton, MarkerNote, Mirror, Portrait, PriceRow, Sign, TicketNumber,
} from '../components/brand/index.jsx';
import { Loading, Notice } from '../components/ui/index.js';
import DeviceGate, { useDevice } from './DeviceGate.jsx';

const RESET_MS = 15_000;
const UNDO_MS = 60_000;

function Steps({ step }) {
  return (
    <ol className="kiosk-steps" aria-label="الخطوات">
      {['الخدمة', 'الحلاق', 'اسمك'].map((label, index) => (
        <li key={label} className={index + 1 === step ? 'on' : index + 1 < step ? 'done' : ''}>
          <span className="num">{index + 1}</span>{label}
        </li>
      ))}
    </ol>
  );
}

function Door() {
  const { unpair } = useDevice();
  const [options, setOptions] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState([]);
  const [barberId, setBarberId] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState(null);
  const resetTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      setOptions(await deviceRequest('kiosk', '/kiosk/options'));
      setError(null);
    } catch (failure) {
      if (failure.status === 401) unpair();
      else setError(failure.message);
    }
  }, [unpair]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const restart = useCallback(() => {
    clearTimeout(resetTimer.current);
    setStep(1); setSelected([]); setBarberId(null); setName(''); setPhone(''); setTicket(null); setError(null);
    load();
  }, [load]);

  // لو حد سابها في النص، ترجع لأوّلها بعد دقيقتين
  useEffect(() => {
    if (step === 1 && selected.length === 0) return undefined;
    const idle = setTimeout(restart, ticket ? RESET_MS : 120_000);
    resetTimer.current = idle;
    return () => clearTimeout(idle);
  }, [step, selected, barberId, name, phone, ticket, restart]);

  async function take() {
    setBusy(true);
    setError(null);
    try {
      const created = await deviceAct('kiosk', '/kiosk/tickets', {
        service_ids: selected, barber_id: barberId, name: name.trim() || null, phone: phone.trim() || null,
      });
      setTicket({ ...created, at: Date.now() });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    try {
      await deviceAct('kiosk', `/kiosk/tickets/${ticket.id}/cancel`);
      restart();
    } catch (failure) {
      setError(failure.message);
    }
  }

  if (!options) return error ? <div className="kiosk"><Notice tone="danger" icon="alert">{error}</Notice></div> : <Loading />;

  const closed = !options.open.open || !options.accepting_tickets;
  const services = options.services;
  const total = services.filter((service) => selected.includes(service.id)).reduce((sum, service) => sum + service.price, 0);

  return (
    <div className="kiosk">
      <header className="kiosk-head">
        <Sign>{options.name}</Sign>
        {!closed && !ticket && <Steps step={step} />}
      </header>

      {closed ? (
        <Mirror arch className="kiosk-center">
          <MarkerNote className="kiosk-big-note">{options.open.open ? 'موقّفين الأدوار دلوقتي' : 'المحل قافل دلوقتي'}</MarkerNote>
          <p className="muted">اسأل حد في المحل</p>
        </Mirror>
      ) : ticket ? (
        <Mirror arch className="kiosk-center kiosk-done" flashKey={ticket.number}>
          <span className="muted">رقم دورك</span>
          <TicketNumber value={ticket.number} size="clamp(6rem, 22vw, 11rem)" />
          <MarkerNote className="kiosk-big-note">
            {/* ahead = null لما مفيش حلاق موجود يتحسب عليه الدور */}
            {ticket.ahead === null || ticket.ahead === undefined ? 'هننادي رقمك أوّل ما حلاق يوصل'
              : ticket.ahead === 0 ? 'إنت الجاي' : <>قدّامك <span className="num">{ticket.ahead}</span></>}
            {ticket.wait_minutes ? <> · حوالي {formatMinutes(ticket.wait_minutes)}</> : null}
          </MarkerNote>
          <p className="muted">استنى رقمك على الشاشة</p>
          <div className="row">
            <button type="button" className="btn lg" onClick={restart}>تمام</button>
            {Date.now() - ticket.at < UNDO_MS && <button type="button" className="btn ghost lg" onClick={undo}>غلطت؟ ألغِ</button>}
          </div>
        </Mirror>
      ) : (
        <Mirror className="kiosk-panel">
          {error && <Notice tone="danger" icon="alert">{error}</Notice>}

          {step === 1 && (
            <div className="stack">
              <h1 className="kiosk-title">عايز تعمل إيه؟</h1>
              <div className="kiosk-services">
                {services.map((service) => {
                  const on = selected.includes(service.id);
                  return (
                    <button key={service.id} type="button" aria-pressed={on} className={`kiosk-service ${on ? 'on' : ''}`.trim()}
                      onClick={() => setSelected((current) => (on ? current.filter((id) => id !== service.id) : [...current, service.id]))}>
                      <PriceRow name={<span className="row tight">{on ? <Icon name="check" size={22} /> : <span className="pick-box" />}{service.name}</span>} price={service.price} />
                    </button>
                  );
                })}
              </div>
              <div className="kiosk-foot">
                <span className="muted">الإجمالي <span className="num bold">{formatMoney(total)}</span></span>
                <LeatherButton disabled={selected.length === 0} onClick={() => setStep(2)}>الجاي</LeatherButton>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="stack">
              <h1 className="kiosk-title">مع مين؟</h1>
              <div className="kiosk-barbers">
                <button type="button" className={`kiosk-barber ${barberId === null ? 'on' : ''}`.trim()} onClick={() => setBarberId(null)}>
                  <span className="portrait"><Icon name="users" size={26} /></span>
                  <span className="bold">أي حد فاضي</span>
                  <span className="small muted">{options.wait_minutes === null ? 'مفيش حد دلوقتي' : options.wait_minutes === 0 ? 'دلوقتي' : `حوالي ${formatMinutes(options.wait_minutes)}`}</span>
                </button>
                {options.barbers.map((barber) => (
                  <button key={barber.id} type="button" className={`kiosk-barber ${barberId === barber.id ? 'on' : ''}`.trim()} onClick={() => setBarberId(barber.id)}>
                    <Portrait name={barber.name} src={barber.photo_path} />
                    <span className="bold">أ. {barber.name}</span>
                    <span className="small muted">{barber.status === 'break' ? 'في الاستراحة' : barber.wait_minutes === 0 ? 'دلوقتي' : `حوالي ${formatMinutes(barber.wait_minutes)}`}</span>
                  </button>
                ))}
              </div>
              <div className="kiosk-foot">
                <button type="button" className="btn lg ghost" onClick={() => setStep(1)}>رجوع</button>
                <LeatherButton onClick={() => setStep(3)}>الجاي</LeatherButton>
              </div>
            </div>
          )}

          {step === 3 && (
            <form className="stack" onSubmit={(event) => { event.preventDefault(); take(); }}>
              <h1 className="kiosk-title">اسمك إيه؟</h1>
              <input className="input kiosk-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus aria-label="الاسم" placeholder="اختياري" />
              <label className="stack sm">
                <span className="muted">موبايلك (اختياري) — عشان نكلّمك لما دورك يقرّب</span>
                <input className="input kiosk-input ltr-input" type="tel" dir="ltr" value={phone} onChange={(event) => setPhone(event.target.value)} aria-label="الموبايل" />
              </label>
              <div className="kiosk-foot">
                <button type="button" className="btn lg ghost" onClick={() => setStep(2)}>رجوع</button>
                <LeatherButton type="submit" loading={busy}>خُد دورك</LeatherButton>
              </div>
            </form>
          )}
        </Mirror>
      )}
      <div className="tiles kiosk-floor" aria-hidden="true" />
    </div>
  );
}

export default function Kiosk() {
  return <DeviceGate type="kiosk" label="تابلت الباب"><Door /></DeviceGate>;
}
