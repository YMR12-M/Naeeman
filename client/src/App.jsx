import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Shell from './components/layout/Shell.jsx';
import { Loading } from './components/ui/index.js';

// الصفحات بتتحمّل عند الطلب: شاشة الدخول وشاشات الأجهزة ما بتستنّاش كود اللوحة كلها
const page = (loader) => lazy(loader);
const Login = page(() => import('./pages/Login.jsx'));
const ForgotPassword = page(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = page(() => import('./pages/ResetPassword.jsx'));
const MustChangePassword = page(() => import('./pages/MustChangePassword.jsx'));
const Setup = page(() => import('./pages/Setup.jsx'));
const Queue = page(() => import('./pages/Queue.jsx'));
const Today = page(() => import('./pages/Today.jsx'));
const Services = page(() => import('./pages/Services.jsx'));
const Barbers = page(() => import('./pages/Barbers.jsx'));
const Devices = page(() => import('./pages/Devices.jsx'));
const Settings = page(() => import('./pages/Settings.jsx'));
const Team = page(() => import('./pages/Team.jsx'));
const Audit = page(() => import('./pages/Audit.jsx'));
const Cashier = page(() => import('./pages/Cashier.jsx'));
const DayClose = page(() => import('./pages/DayClose.jsx'));
const Products = page(() => import('./pages/Products.jsx'));
const Payroll = page(() => import('./pages/Payroll.jsx'));
const Customers = page(() => import('./pages/Customers.jsx'));
const NotFound = page(() => import('./pages/NotFound.jsx'));
const Display = page(() => import('./screens/Display.jsx'));
const Kiosk = page(() => import('./screens/Kiosk.jsx'));
const Chair = page(() => import('./screens/Chair.jsx'));

/** حارس: لازم موظف داخل، وإلا شاشة الدخول (مع حفظ الوجهة للرجوع ليها) */
function RequireAuth({ children }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading label="بنفتح الجلسة…" />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  return children;
}

function GuestOnly({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <Loading />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return children;
}

function StaffRoutes() {
  const { status, user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/change-password"
        element={status === 'authenticated' && user.must_change_password ? <MustChangePassword /> : <Navigate to="/" replace />}
      />
      <Route element={<RequireAuth><Shell /></RequireAuth>}>
        <Route index element={<Queue />} />
        <Route path="setup" element={<Setup />} />
        <Route path="today" element={<Today />} />
        <Route path="cashier" element={<Cashier />} />
        <Route path="day-close" element={<DayClose />} />
        <Route path="products" element={<Products />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="customers" element={<Customers />} />
        <Route path="services" element={<Services />} />
        <Route path="barbers" element={<Barbers />} />
        <Route path="devices" element={<Devices />} />
        <Route path="settings" element={<Settings />} />
        <Route path="team" element={<Team />} />
        <Route path="audit" element={<Audit />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* شاشات الأجهزة: من غير حساب موظف، بتوكن الجهاز بس */}
        <Route path="/display" element={<Display />} />
        <Route path="/kiosk" element={<Kiosk />} />
        <Route path="/chair" element={<Chair />} />
        <Route path="/*" element={<AuthProvider><StaffRoutes /></AuthProvider>} />
      </Routes>
    </Suspense>
  );
}
