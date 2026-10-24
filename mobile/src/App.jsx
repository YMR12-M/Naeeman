import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Loading } from './components/ui/index.js';
import Layout from './components/Layout.jsx';
import { safeNext } from './lib/nav.js';

// الصفحات بتتحمّل عند الطلب: صفحة المحل (أوّل حاجة الزبون بيفتحها من الـ QR) خفيفة
const Home = lazy(() => import('./pages/Home.jsx'));
const Shop = lazy(() => import('./pages/Shop.jsx'));
const Take = lazy(() => import('./pages/Take.jsx'));
const Turn = lazy(() => import('./pages/Turn.jsx'));
const CheckIn = lazy(() => import('./pages/CheckIn.jsx'));
const History = lazy(() => import('./pages/History.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

/** الصفحات اللي محتاجة حساب: لو مش داخل يروح للدخول ويرجع لنفس المكان بعده */
function RequireCustomer({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading label="بنفتح حسابك…" />;
  if (status === 'anonymous') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}

function GuestOnly({ children }) {
  const { status } = useAuth();
  const next = new URLSearchParams(useLocation().search).get('next');
  if (status === 'loading') return <Loading />;
  if (status === 'authenticated') return <Navigate to={safeNext(next)} replace />;
  return children;
}

/** الإشعار اتداس والتطبيق مفتوح: الـ service worker بيقولنا نروح فين */
function useServiceWorkerNavigation() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (event) => {
      if (event.data?.type === 'navigate' && typeof event.data.path === 'string') navigate(safeNext(event.data.path));
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);
}

export default function App() {
  useServiceWorkerNavigation();
  const guarded = (element) => <RequireCustomer>{element}</RequireCustomer>;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="s/:slug" element={<Shop />} />
          <Route path="s/:slug/take" element={guarded(<Take />)} />
          <Route path="turn" element={guarded(<Turn />)} />
          <Route path="turn/:id" element={guarded(<Turn />)} />
          <Route path="checkin/:slug" element={guarded(<CheckIn />)} />
          <Route path="history" element={guarded(<History />)} />
          <Route path="account" element={guarded(<Account />)} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
