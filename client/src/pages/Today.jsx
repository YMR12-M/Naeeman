/**
 * النهارده: ملخّص يوم الشغل زي دفتر المحل آخر اليوم — الإيراد كبير في
 * مراية، والباقي سطور بنقط زي قايمة الأسعار. المرحلة الأولى بتعتبر كل دور
 * خلص اتدفع كاش بإجمالي خدماته.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { formatDate, formatMinutes, formatMoney, formatNumber } from '../lib/format.js';
import { Empty, Input, Loading } from '../components/ui/index.js';
import { Mirror, Portrait, PriceRow, TicketNumber } from '../components/brand/index.jsx';
import PageHead from '../components/layout/PageHead.jsx';

function Line({ label, value }) {
  return (
    <div className="price-row ledger-line">
      <span>{label}</span>
      <span className="leader" aria-hidden="true" />
      <span className="price">{value}</span>
    </div>
  );
}

export default function Today() {
  useDocumentTitle('النهارده');
  const [date, setDate] = useState('');
  const report = useQuery({
    queryKey: ['reports', 'today', date],
    queryFn: () => api.get('/reports/today', date ? { date } : undefined),
    refetchInterval: date ? false : 60_000,
  });

  const day = report.data;
  return (
    <div className="stack lg">
      <PageHead title="النهارده" note={day && <span className="muted">{formatDate(day.business_date)}</span>}>
        <label className="row tight small">
          <span className="muted">يوم تاني</span>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ width: 170 }} />
        </label>
      </PageHead>

      {!day ? <Loading /> : (
        <div className="today">
          <Mirror arch className="revenue">
            <span className="muted">إيراد اليوم</span>
            <TicketNumber value={formatNumber(day.revenue / 100)} size="3.4rem" />
            <span className="muted">جنيه من <span className="num">{day.done}</span> دور خلص</span>
          </Mirror>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">الأدوار</h2></div>
            <div className="panel-body stack sm">
              <Line label="كل الأدوار" value={<span className="num">{day.tickets}</span>} />
              <Line label="خلصوا" value={<span className="num">{day.done}</span>} />
              <Line label="لسه شغّالين" value={<span className="num">{day.active}</span>} />
              <Line label="ما جوش" value={<span className="num">{day.no_show}</span>} />
              <Line label="اتلغوا" value={<span className="num">{day.cancelled}</span>} />
              <Line label="متوسّط الانتظار" value={day.avg_wait_minutes === null ? '—' : formatMinutes(day.avg_wait_minutes)} />
              <Line label="متوسّط الخدمة" value={day.avg_service_minutes === null ? '—' : formatMinutes(day.avg_service_minutes)} />
              <Line label="من التطبيق" value={<span className="num">{day.by_source.app}</span>} />
              <Line label="من تابلت الباب" value={<span className="num">{day.by_source.kiosk}</span>} />
              <Line label="من الاستقبال" value={<span className="num">{day.by_source.staff}</span>} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">الحلاقين</h2></div>
            <div className="panel-body">
              {day.barbers.length === 0 ? <Empty icon="chair">لسه محدش خلّص دور.</Empty> : (
                <ul className="barber-day">
                  {day.barbers.map((barber) => (
                    <li key={barber.id}>
                      <Portrait name={barber.name} />
                      <div className="grow">
                        <div className="bold">{barber.name}</div>
                        <div className="small muted">
                          <span className="num">{barber.done}</span> دور
                          {barber.avg_service_minutes !== null && <> · متوسّط {formatMinutes(barber.avg_service_minutes)}</>}
                        </div>
                      </div>
                      <span className="num bold">{formatMoney(barber.revenue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">الخدمات</h2></div>
            <div className="panel-body stack sm">
              {day.services.length === 0 ? <Empty icon="list">مفيش خدمات خلصت النهارده.</Empty>
                : day.services.map((service) => (
                  <PriceRow key={service.name} name={<>{service.name} <span className="small muted">× <span className="num">{service.count}</span></span></>} price={service.revenue} />
                ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
