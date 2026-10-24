/**
 * «وصلت» — الكود اللي على شاشة التلفزيون بيتغيّر كل دقيقة، فمحدش يعمل
 * check-in من البيت. تلات طرق:
 *  1) كاميرا الموبايل نفسها: الـ QR بيفتح الرابط ده والكود فيه ← تلقائي.
 *  2) الماسح جوّه التطبيق.
 *  3) الكود مكتوب على الشاشة جنب الـ QR: يكتبه بإيده.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useDocumentTitle } from '../lib/hooks.js';
import { readScan } from '../lib/shop.js';
import { useToast } from '../context/ToastContext.jsx';
import { LeatherButton, Mirror } from '../components/brand/index.jsx';
import { Button, Empty, Loading, Notice } from '../components/ui/index.js';
import Scanner from '../components/Scanner.jsx';

export default function CheckIn() {
  useDocumentTitle('وصلت');
  const { slug } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const active = useQuery({ queryKey: ['active-ticket'], queryFn: () => api.get('/me/tickets/active'), staleTime: 0 });
  const [code, setCode] = useState(params.get('code') ?? '');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const tried = useRef(false);

  const ticket = active.data?.ticket;

  const submit = useCallback(async (value) => {
    if (!ticket || !/^\d{6}$/.test(value)) { setError('الكود 6 أرقام — هتلاقيه تحت الـ QR على الشاشة'); return; }
    setBusy(true);
    setError(null);
    try {
      const view = await api.act(`/me/tickets/${ticket.id}/check-in`, { code: value });
      queryClient.setQueryData(['active-ticket'], view);
      toast.success('وصلت ✓ — استنى رقمك على الشاشة');
      navigate(`/turn/${ticket.id}`, { replace: true });
    } catch (failure) {
      setError(failure.code === 'BAD_CHECKIN_CODE' ? 'الكود ده قديم أو غلط — الكود بيتغيّر كل دقيقة، امسح اللي على الشاشة دلوقتي' : failure.message);
      setScanning(false);
    } finally {
      setBusy(false);
    }
  }, [ticket, queryClient, toast, navigate]);

  // جاي من كاميرا الموبايل والكود في الرابط: نعمل check-in على طول مرّة واحدة
  useEffect(() => {
    if (!ticket || tried.current || !params.get('code')) return;
    tried.current = true;
    submit(params.get('code'));
  }, [ticket, params, submit]);

  if (active.isLoading) return <Loading />;
  if (!ticket) {
    return (
      <Mirror className="page-card">
        <Empty icon="hourglass" title="معاكش دور دلوقتي">خُد دور الأوّل، وبعدين اعمل «وصلت» لما توصل المحل.</Empty>
        <div className="row center"><Link className="leather" to={`/s/${slug}`}>خُد دورك</Link></div>
      </Mirror>
    );
  }
  if (ticket.arrived) {
    return (
      <Mirror className="page-card stack center">
        <p className="bold">إنت متسجّل إنك وصلت ✓</p>
        <Link className="btn" to={`/turn/${ticket.id}`}>رجوع لدوري</Link>
      </Mirror>
    );
  }

  const onScan = (text) => {
    const result = readScan(text);
    if (!result?.code) return false;
    setCode(result.code);
    setScanning(false);
    submit(result.code);
    return true;
  };

  return (
    <div className="stack lg">
      <h1 className="page-title">وصلت المحل؟</h1>
      <p className="muted">امسح الـ QR اللي مكتوب جنبه «وصلت؟» على شاشة المحل، أو اكتب الأرقام اللي تحته.</p>
      {error && <Notice tone="danger" icon="alert">{error}</Notice>}

      {scanning
        ? <Scanner onResult={onScan} onError={(message) => { setError(message); setScanning(false); }} />
        : <Button variant="primary" icon="camera" onClick={() => { setError(null); setScanning(true); }}>افتح الكاميرا</Button>}

      <form className="stack" onSubmit={(event) => { event.preventDefault(); submit(code); }} noValidate>
        <label className="stack sm">
          <span className="small muted">أو اكتب الكود</span>
          <input
            className="input code-input" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6}
            aria-label="كود الوصول" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </label>
        <LeatherButton type="submit" block loading={busy}>وصلت</LeatherButton>
      </form>
    </div>
  );
}
