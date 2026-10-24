/**
 * الرئيسية: لو معاك دور ← «دوري». لو فتحت محل قبل كده ← صفحته.
 * غير كده: امسح الـ QR اللي على شاشة المحل (أو باب المحل).
 */
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { lastShop, readScan } from '../lib/shop.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Mirror, Sign, Wordmark } from '../components/brand/index.jsx';
import { Button, Loading, Notice } from '../components/ui/index.js';
import Scanner from '../components/Scanner.jsx';

export default function Home() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const active = useQuery({ queryKey: ['active-ticket'], queryFn: () => api.get('/me/tickets/active'), enabled: status === 'authenticated' });

  if (status === 'loading' || (status === 'authenticated' && active.isLoading)) return <Loading />;
  if (active.data?.ticket) return <Navigate to={`/turn/${active.data.ticket.id}`} replace />;
  const shop = lastShop();
  if (shop) return <Navigate to={`/s/${shop}`} replace />;

  const onScan = (text) => {
    const result = readScan(text);
    if (result?.path) { navigate(result.path); return true; }
    if (result?.slug) { navigate(`/checkin/${result.slug}?code=${result.code}`); return true; }
    setError('ده مش QR بتاع محل — امسح اللي على شاشة المحل');
    return false;
  };

  return (
    <div className="stack lg center welcome">
      <Sign size="lg" aria-hidden="true"><Wordmark height="1.6em" /></Sign>
      <Mirror arch className="stack center welcome-mirror">
        <h1 className="page-title">دورك في محل الحلاقة، من موبايلك</h1>
        <p className="muted">امسح الـ QR اللي على شاشة المحل أو على الباب، وخُد دورك وإنت في البيت.</p>
      </Mirror>
      {error && <Notice tone="danger" icon="alert">{error}</Notice>}
      {scanning
        ? <Scanner onResult={onScan} onError={(message) => { setError(message); setScanning(false); }} />
        : <Button variant="primary" size="lg" icon="qr" onClick={() => { setError(null); setScanning(true); }}>امسح QR المحل</Button>}
    </div>
  );
}
