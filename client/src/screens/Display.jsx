/**
 * ═══════════════════════════════════════════════════════════════
 *  شاشة التلفزيون — حيطة المرايات
 *
 *  مراية مقوّسة لكل حلاق فوقها اسمه وجوّاها رقم الزبون اللي معاه، ومراية
 *  مستطيلة فيها «الجايين» بالماركر، ويافطة المحل، وشريط بلاط تحت فيه QR
 *  لأخد دور وكود «وصلت» المتغيّر كل دقيقة. من غير أي زراير.
 *  الأحجام محسوبة على إن الناس بتقرا من 4 متر (رقم الدور ≥ 80px على 1080p).
 * ═══════════════════════════════════════════════════════════════
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { deviceHeaders, deviceRequest } from '../lib/device.js';
import { useLive } from '../lib/live.js';
import { formatMinutes } from '../lib/format.js';
import { MarkerNote, Mirror, OpenSign, Sign, TicketNumber, Wordmark } from '../components/brand/index.jsx';
import { Loading } from '../components/ui/index.js';
import DeviceGate, { useDevice } from './DeviceGate.jsx';

function Qr({ text, label }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#143C38', light: '#E9F1EE' } })
      .then((markup) => { if (alive) setSvg(markup); });
    return () => { alive = false; };
  }, [text]);
  return <span className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Wall() {
  const { unpair } = useDevice();
  const live = useLive({
    path: '/display/stream',
    load: () => deviceRequest('display', '/display/queue'),
    headers: async () => deviceHeaders('display'),
    onFatal: ({ code }) => { if (code === 'DEVICE_REVOKED' || code === 'NO_DEVICE_TOKEN' || code === 'WRONG_DEVICE_TYPE') unpair(); },
  });
  const view = live.data;
  if (!view) return <Loading label="بنجهّز الشاشة…" />;

  return (
    <div className="tv">
      <header className="tv-head">
        <Sign size="lg">{view.shop.name}</Sign>
        <div className="tv-head-side">
          <OpenSign open={view.open.open} />
          <span className="tv-wait">
            {view.wait_minutes === null ? 'مفيش حلاقين دلوقتي' : view.wait_minutes === 0 ? 'مفيش انتظار دلوقتي' : <>الانتظار دلوقتي حوالي {formatMinutes(view.wait_minutes)}</>}
          </span>
        </div>
      </header>

      <main className="tv-wall">
        <div className="tv-mirrors" style={{ '--count': Math.max(view.barbers.length, 1) }}>
          {view.barbers.map((barber) => (
            <div key={barber.id} className="tv-barber">
              <Sign size="sm">أ. {barber.name}</Sign>
              <Mirror arch className="tv-mirror" flashKey={barber.serving?.number}>
                {barber.serving ? (
                  <>
                    <TicketNumber value={barber.serving.number} size="var(--tv-number)" />
                    {barber.serving.name && <span className="tv-name">{barber.serving.name}</span>}
                  </>
                ) : (
                  <MarkerNote className="tv-note">{barber.status === 'break' ? 'في الاستراحة' : 'فاضي'}</MarkerNote>
                )}
              </Mirror>
            </div>
          ))}
          {view.barbers.length === 0 && <Mirror className="tv-mirror"><MarkerNote className="tv-note">الحلاقين لسه ما وصلوش</MarkerNote></Mirror>}
        </div>

        <Mirror className="tv-next">
          <span className="tv-next-title">الجايين</span>
          {view.next.length === 0 ? <MarkerNote className="tv-note">مفيش حد مستني</MarkerNote> : (
            <ol>
              {view.next.map((ticket) => (
                <li key={ticket.number} className={ticket.called ? 'called' : ''}>
                  <MarkerNote flat>
                    <span className="num">{ticket.number}</span>
                    {ticket.name && <> {ticket.name}</>}
                    {ticket.called && <> ← اتنادى</>}
                  </MarkerNote>
                </li>
              ))}
            </ol>
          )}
          {view.waiting_count > view.next.length && <span className="tv-more">و<span className="num">{view.waiting_count - view.next.length}</span> كمان</span>}
        </Mirror>
      </main>

      <footer className="tiles tv-floor">
        <div className="tv-qr">
          <Qr text={view.take_url} label="امسح عشان تاخد دور" />
          <span>خُد دورك من موبايلك</span>
        </div>
        <span className="tv-brand"><Wordmark height="1.6em" /></span>
        <div className="tv-qr">
          <Qr text={view.checkin.url} label="امسح لما توصل" />
          <span>وصلت؟ امسح ده <span className="tv-code num">{view.checkin.code}</span></span>
        </div>
      </footer>
    </div>
  );
}

export default function Display() {
  return <DeviceGate type="display" label="شاشة التلفزيون"><Wall /></DeviceGate>;
}
