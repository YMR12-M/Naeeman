/**
 * صفحة المحل العامة (من غير حساب): اليافطة ويافطة «مفتوح»، والانتظار
 * دلوقتي عند كل حلاق، وقايمة الأسعار، وزرار «خُد دورك».
 * دي الصفحة اللي الـ QR على التلفزيون بيفتحها. لايف من غير ما حد يحدّث.
 */
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useLive, publicHeaders } from '../lib/live.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatMinutes, formatPhone, formatTime, WEEKDAYS } from '../lib/format.js';
import { rememberShop } from '../lib/shop.js';
import { Icon } from '../lib/icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  LeatherButton, MarkerNote, Mirror, OpenSign, Portrait, PriceRow, Sign,
} from '../components/brand/index.jsx';
import { Loading, Notice } from '../components/ui/index.js';
import { LoyaltyNote, StampRow } from '../components/CardBits.jsx';

const waitText = (minutes) => (minutes === null ? 'مفيش حد دلوقتي' : minutes === 0 ? 'من غير انتظار' : `حوالي ${formatMinutes(minutes)}`);

/** ليه مينفعش ياخد دور دلوقتي (أو null لو ينفع) */
export function closedReason(shop) {
  if (!shop.open.open) return shop.open.next_opens_at ? `المحل قافل — بيفتح ${formatTime(shop.open.next_opens_at)}` : 'المحل قافل دلوقتي';
  if (!shop.accepting_tickets) return 'المحل موقّف الأدوار دلوقتي — جرّب كمان شوية';
  if (!shop.remote_tickets_enabled) return 'المحل ده بياخد الأدوار من الباب بس';
  if (shop.wait_minutes === null) return 'مفيش حلاقين شغّالين دلوقتي';
  return null;
}

/** كارت الأختام بتاعي في المحل ده (لو داخل ولسه ما زارش المحل ما بيظهرش) */
function MyCard({ slug }) {
  const { status } = useAuth();
  const cards = useQuery({
    queryKey: ['cards'],
    queryFn: () => api.get('/me/cards'),
    enabled: status === 'authenticated',
  });
  const card = cards.data?.find((item) => item.shop_slug === slug);
  if (!card?.loyalty?.enabled) return null;
  return (
    <Mirror thin className="stack sm page-card stamp-card">
      <h2>كارت الأختام</h2>
      <StampRow loyalty={card.loyalty} />
      <LoyaltyNote loyalty={card.loyalty} />
      <span className="xsmall muted">زرت المحل <span className="num">{card.visits}</span> {card.visits === 1 ? 'مرّة' : 'مرّات'}</span>
    </Mirror>
  );
}

function TodayHours({ hours }) {
  const today = new Date().getDay();
  const periods = hours.filter((period) => Number(period.weekday) === today);
  if (periods.length === 0) return <span className="muted">النهارده إجازة</span>;
  const hm = (time) => String(time).slice(0, 5);
  return (
    <span>
      النهارده ({WEEKDAYS[today]}):{' '}
      {/* «من … لحد …» بالكلام: الشَرطة بين ساعتين بتتقري بالعكس جوّه سطر عربي */}
      {periods.map((period, index) => (
        <span key={index}>
          {index > 0 ? ' · ' : ''}من <span className="num">{hm(period.opens_at)}</span> لحد <span className="num">{hm(period.closes_at)}</span>
        </span>
      ))}
    </span>
  );
}

export default function Shop() {
  const { slug } = useParams();
  const { status } = useAuth();
  const live = useLive({
    path: `/public/shops/${slug}/stream`,
    load: () => api.public(`/public/shops/${slug}`),
    headers: publicHeaders,
  });
  const active = useQuery({
    queryKey: ['active-ticket'],
    queryFn: () => api.get('/me/tickets/active'),
    enabled: status === 'authenticated',
  });
  const shop = live.data;
  useDocumentTitle(shop?.name);
  useEffect(() => { if (shop) rememberShop(slug); }, [shop, slug]);

  if (!shop) {
    if (live.error?.code === 'SHOP_NOT_FOUND') {
      return <Mirror className="page-card"><Notice tone="danger" icon="alert">المحل ده مش موجود — اتأكد من الرابط أو امسح الـ QR تاني.</Notice></Mirror>;
    }
    return live.error ? <Notice tone="danger" icon="alert">{live.error.message}</Notice> : <Loading label="بنفتح المحل…" />;
  }

  const myTicket = active.data?.ticket;
  const reason = closedReason(shop);

  return (
    <div className="stack lg shop-page">
      <section className="storefront">
        <Sign size="lg" as="h1">{shop.name}</Sign>
        <OpenSign open={shop.open.open} />
        {(shop.address || shop.city) && <p className="small"><Icon name="pin" size={15} /> {[shop.address, shop.city].filter(Boolean).join('، ')}</p>}
        <p className="small"><TodayHours hours={shop.hours} /></p>
      </section>

      <Mirror arch className="wait-mirror" flashKey={shop.waiting_count}>
        <span className="muted">مستنيين دلوقتي</span>
        <span className="ticket-number wait-count">{shop.waiting_count}</span>
        <MarkerNote value={shop.wait_minutes}>{waitText(shop.wait_minutes)}</MarkerNote>
      </Mirror>

      {myTicket ? (
        <Link className="leather block take-link" to={`/turn/${myTicket.id}`}>معاك دور — رقم <span className="num">{myTicket.number}</span></Link>
      ) : reason ? (
        <Notice icon="info">{reason}</Notice>
      ) : (
        <Link to={`/s/${slug}/take`} className="leather block take-link">خُد دورك</Link>
      )}

      <MyCard slug={slug} />

      {shop.barbers.length > 0 && (
        <section className="stack">
          <h2>الحلاقين</h2>
          <ul className="barber-strip">
            {shop.barbers.map((barber) => (
              <li key={barber.id}>
                <Portrait name={barber.name} src={barber.photo_path} />
                <span className="bold">أ. {barber.name}</span>
                <span className="small muted">{barber.status === 'break' ? 'في الاستراحة' : waitText(barber.wait_minutes)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stack">
        <h2>قايمة الأسعار</h2>
        <Mirror thin className="price-list">
          {shop.services.map((service) => (
            <PriceRow key={service.id} name={service.name} price={service.price} />
          ))}
        </Mirror>
      </section>

      {(shop.phone || shop.whatsapp) && (
        <p className="small center muted">
          للتواصل: <a href={`tel:${shop.phone || shop.whatsapp}`} className="num">{formatPhone(shop.phone || shop.whatsapp)}</a>
        </p>
      )}
    </div>
  );
}
