/**
 * مواعيد الأسبوع: لكل يوم فترة أو اتنين أو تلاتة، أو إجازة.
 * فترة بتقفل قبل ما تفتح = بتعدّي نص الليل (شائع في محلات الحلاقة)،
 * والفتح = القفل يعني 24 ساعة. الأسبوع بيبدأ بالسبت زي الشغل في مصر.
 */
import { WEEKDAYS } from '../../lib/format.js';
import { Button, Switch } from '../ui/index.js';

const ORDER = [6, 0, 1, 2, 3, 4, 5];
const MAX_PERIODS = 3;

function periodNote(period) {
  if (period.opens_at === period.closes_at) return '24 ساعة';
  if (period.closes_at < period.opens_at) return 'بيقفل بعد نص الليل';
  return null;
}

export default function HoursEditor({ value, onChange, error }) {
  const byDay = (weekday) => value.filter((period) => period.weekday === weekday);
  const replaceDay = (weekday, periods) => onChange([
    ...value.filter((period) => period.weekday !== weekday),
    ...periods.map((period) => ({ ...period, weekday })),
  ].sort((a, b) => a.weekday - b.weekday || a.opens_at.localeCompare(b.opens_at)));

  const copyToAll = (weekday) => {
    const source = byDay(weekday);
    onChange(ORDER.flatMap((day) => source.map((period) => ({ ...period, weekday: day }))));
  };

  return (
    <div className="hours">
      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
      {ORDER.map((weekday) => {
        const periods = byDay(weekday);
        const open = periods.length > 0;
        return (
          <div key={weekday} className="hours-day">
            <div className="hours-name">
              <Switch
                checked={open}
                onChange={(checked) => replaceDay(weekday, checked ? [{ opens_at: '12:00', closes_at: '00:00' }] : [])}
                label={<span className="bold">{WEEKDAYS[weekday]}</span>}
              />
            </div>
            <div className="hours-periods">
              {!open && <span className="muted small">إجازة</span>}
              {periods.map((period, index) => (
                <div key={index} className="hours-period">
                  <input
                    type="time" className="input" aria-label={`${WEEKDAYS[weekday]} من`} value={period.opens_at}
                    onChange={(event) => replaceDay(weekday, periods.map((item, i) => (i === index ? { ...item, opens_at: event.target.value } : item)))}
                  />
                  <span className="muted">لحد</span>
                  <input
                    type="time" className="input" aria-label={`${WEEKDAYS[weekday]} لحد`} value={period.closes_at}
                    onChange={(event) => replaceDay(weekday, periods.map((item, i) => (i === index ? { ...item, closes_at: event.target.value } : item)))}
                  />
                  {periodNote(period) && <span className="marker flat small">{periodNote(period)}</span>}
                  {periods.length > 1 && (
                    <Button size="sm" variant="ghost" icon="close" aria-label="شيل الفترة" onClick={() => replaceDay(weekday, periods.filter((_, i) => i !== index))} />
                  )}
                </div>
              ))}
            </div>
            <div className="hours-tools">
              {open && periods.length < MAX_PERIODS && (
                <Button size="sm" variant="ghost" icon="plus" onClick={() => replaceDay(weekday, [...periods, { opens_at: '17:00', closes_at: '23:00' }])}>فترة</Button>
              )}
              {open && <Button size="sm" variant="ghost" icon="copy" onClick={() => copyToAll(weekday)}>للكل</Button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
