/**
 * الزباين: كروت زباين المحل (بحث بالاسم أو الموبايل)، و«وحشونا»: اللي بعدوا
 * عن المحل أكتر من أيام الإعداد، برسالة واتساب جاهزة للي معندوش التطبيق.
 */
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Icon } from '../lib/icons.jsx';
import { useDebounce, useDocumentTitle } from '../lib/hooks.js';
import { formatDate, formatMoney, whatsappLink } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Empty, Loading, Notice, SearchInput, Segmented } from '../components/ui/index.js';
import { MarkerNote, Mirror } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';
import CardModal from '../components/shop/CardModal.jsx';

const day = (value) => (value ? formatDate(String(value).slice(0, 10)) : '—');
const firstName = (name) => String(name || '').split(/\s+/)[0];

function sinceText(days) {
  if (days >= 28 && days < 45) return 'بقالك شهر';
  const weeks = Math.round(days / 7);
  if (days >= 14) return weeks === 2 ? 'بقالك أسبوعين' : `بقالك ${weeks} أسابيع`;
  return `بقالك ${days} يوم`;
}

function AllCards({ onOpen }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounce(q.trim(), 300);
  const cards = useQuery({
    queryKey: ['cards', search, page],
    queryFn: () => api.page('/cards', { q: search || undefined, page, page_size: 30 }),
    keepPreviousData: true,
  });

  return (
    <div className="stack">
      <SearchInput value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="اسم أو موبايل" aria-label="دوّر على زبون" />
      {!cards.data ? <Loading /> : cards.data.rows.length === 0 ? (
        <Mirror><Empty icon="users" title={search ? 'مفيش زبون بالاسم ده' : 'لسه مفيش كروت'}>الكارت بيتعمل لوحده لما الزبون ياخد دور برقم موبايل.</Empty></Mirror>
      ) : (
        <>
          <Mirror className="bill-list-wrap">
            <ul className="bill-list">
              {cards.data.rows.map((card) => (
                <li key={card.id}>
                  <button type="button" className="bill-row" onClick={() => onOpen(card.id)}>
                    <span className="grow">
                      <span className="bold">{card.name}</span>
                      {card.has_app && <span className="badge ok" style={{ marginInlineStart: 6 }}>تطبيق</span>}
                      <span className="small muted block">
                        {card.phone && <span className="num">{card.phone} · </span>}
                        <span className="num">{card.visits}</span> زيارة · آخر مرّة {day(card.last_visit_at)}
                        {card.last_barber_name && ` · أ. ${card.last_barber_name}`}
                      </span>
                      {card.notes && <span className="small block truncate"><Icon name="edit" size={12} /> {card.notes}</span>}
                    </span>
                    <span className="num bold">{formatMoney(card.total_spent)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Mirror>
          {cards.data.meta.total_pages > 1 && (
            <div className="row between">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>اللي قبل</Button>
              <span className="small muted"><span className="num">{page}</span> من <span className="num">{cards.data.meta.total_pages}</span></span>
              <Button size="sm" disabled={page >= cards.data.meta.total_pages} onClick={() => setPage((value) => value + 1)}>اللي بعد</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MissedYou({ onOpen }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const due = useQuery({ queryKey: ['cards', 'reminders'], queryFn: () => api.get('/cards/reminders') });

  async function mark(card) {
    try {
      await api.post(`/cards/${card.id}/reminded`);
      queryClient.invalidateQueries({ queryKey: ['cards', 'reminders'] });
    } catch (error) {
      toast.error(error.message);
    }
  }

  if (!due.data) return <Loading />;
  if (!due.data.enabled) {
    return (
      <Notice icon="bell">
        التذكير مقفول. {can('shop.write') ? <NavLink to="/settings">شغّله من الإعدادات</NavLink> : 'المالك يقدر يشغّله من الإعدادات'} عشان تشوف الزباين اللي بعدوا.
      </Notice>
    );
  }
  const message = (card) => `أهلًا ${firstName(card.name)} 👋 ${sinceText(card.days_since)} من آخر حلاقة في ${user.shop.name}. تحب تحجز دورك؟ ${due.data.shop_url}`;

  return (
    <div className="stack">
      <p className="small muted">
        الزباين اللي آخر زيارة ليهم من أكتر من <span className="num">{due.data.days}</span> يوم. اللي عنده التطبيق وإشعاراته شغّالة بيوصله إشعار لوحده؛ الباقي ابعتله واتساب ودوس «اتبعت».
      </p>
      {due.data.rows.length === 0 ? (
        <Mirror><Empty icon="users" title="مفيش حد بعيد">كل الزباين جم قريب.</Empty></Mirror>
      ) : (
        <Mirror className="bill-list-wrap">
          <MarkerNote flat>{due.data.rows.length} وحشونا</MarkerNote>
          <ul className="bill-list">
            {due.data.rows.map((card) => (
              <li key={card.id} className="missed-row">
                <button type="button" className="grow bill-row plain" onClick={() => onOpen(card.id)}>
                  <span className="grow">
                    <span className="bold">{card.name}</span>
                    <span className="small muted block">{sinceText(card.days_since)} · <span className="num">{card.visits}</span> زيارة{card.last_barber_name && ` · أ. ${card.last_barber_name}`}</span>
                  </span>
                </button>
                {card.has_push ? <span className="badge ok">بيوصله إشعار</span> : card.phone ? (
                  <a className="btn sm" href={whatsappLink(card.phone, message(card))} target="_blank" rel="noreferrer">
                    <Icon name="whatsapp" size={16} />واتساب
                  </a>
                ) : <span className="badge">من غير موبايل</span>}
                {!card.has_push && <Button size="sm" variant="ghost" icon="check" onClick={() => mark(card)}>اتبعت</Button>}
              </li>
            ))}
          </ul>
        </Mirror>
      )}
    </div>
  );
}

export default function Customers() {
  useDocumentTitle('الزباين');
  const [tab, setTab] = useState('all');
  const [open, setOpen] = useState(null);
  return (
    <div className="stack lg">
      <PageHead title="الزباين">
        <Segmented label="العرض" value={tab} onChange={setTab} options={[{ value: 'all', label: 'كل الكروت' }, { value: 'missed', label: 'وحشونا' }]} />
      </PageHead>
      {tab === 'all' ? <AllCards onOpen={setOpen} /> : <MissedYou onOpen={setOpen} />}
      {open && <CardModal cardId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
