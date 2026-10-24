/**
 * هيكل اللوحة: الحيطة النعناعي على الجنب (فيها اليافطة والتنقّل)، والبلاط
 * هو أرضية الشغل. على الموبايل الحيطة بتبقى درج بيتفتح من زرار.
 */
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { Icon } from '../../lib/icons.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { Drawer } from '../ui/index.js';
import { Sign, Wordmark } from '../brand/index.jsx';

const NAV = [
  { to: '/', label: 'الطابور', icon: 'scissors', permission: 'queue.read', end: true },
  { to: '/today', label: 'النهارده', icon: 'chart', permission: 'reports.read' },
  { to: '/services', label: 'قايمة الأسعار', icon: 'list', permission: 'services.read' },
  { to: '/barbers', label: 'الحلاقين', icon: 'chair', permission: 'barbers.read' },
  { to: '/devices', label: 'الأجهزة', icon: 'tv', permission: 'devices.manage' },
  { to: '/settings', label: 'الإعدادات', icon: 'settings', permission: 'shop.write' },
  { to: '/team', label: 'الفريق', icon: 'users', permission: 'users.read' },
  { to: '/audit', label: 'السجل', icon: 'shield', permission: 'audit.read' },
];

const ROLE_LABELS = { owner: 'مالك', manager: 'مدير', cashier: 'استقبال' };

/** المحل محتاج تجهيز؟ (مواعيد · خدمات · حلاقين) */
export function useSetupState(enabled) {
  const shop = useQuery({ queryKey: ['shop'], queryFn: () => api.get('/shop'), enabled });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get('/services'), enabled });
  const barbers = useQuery({ queryKey: ['barbers'], queryFn: () => api.get('/barbers'), enabled });
  const ready = shop.data && services.data && barbers.data;
  return {
    shop: shop.data,
    loading: !ready,
    missing: ready ? {
      hours: shop.data.hours.length === 0,
      services: services.data.length === 0,
      barbers: barbers.data.length === 0,
    } : null,
  };
}

function Navigation({ onNavigate }) {
  const { user, can, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const nextTheme = { auto: 'light', light: 'dark', dark: 'auto' }[preference];
  const themeLabel = { auto: 'زي الجهاز', light: 'نهار', dark: 'بالليل' }[preference];

  return (
    <div className="sidebar-inner">
      <div className="sidebar-brand">
        <Sign className="brand-sign"><Wordmark height="1.6em" /></Sign>
        <div className="shop-name">{user.shop.name}</div>
      </div>
      <nav className="nav" aria-label="التنقّل">
        {NAV.filter((item) => can(item.permission)).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate}>
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="who">
          <span className="bold truncate">{user.full_name}</span>
          <span className="small muted">{ROLE_LABELS[user.role]}</span>
        </div>
        <div className="row tight">
          <button type="button" className="btn ghost sm" onClick={() => setPreference(nextTheme)} title="الإضاءة">
            <Icon name={preference === 'dark' ? 'moon' : 'sun'} size={16} />{themeLabel}
          </button>
          <button type="button" className="btn ghost sm" onClick={logout}>
            <Icon name="logout" size={16} />خروج
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Shell() {
  const [open, setOpen] = useState(false);
  const { can } = useAuth();
  const { pathname } = useLocation();
  const setup = useSetupState(can('shop.write'));
  const needsSetup = setup.missing && Object.values(setup.missing).some(Boolean) && pathname !== '/setup';

  return (
    <div className="shell">
      <aside className="sidebar"><Navigation /></aside>
      <header className="topbar">
        <button type="button" className="btn ghost icon" onClick={() => setOpen(true)} aria-label="القايمة">
          <Icon name="menu" />
        </button>
        <Sign size="sm"><Wordmark height="1.35em" /></Sign>
      </header>
      <Drawer open={open} onClose={() => setOpen(false)}>
        <Navigation onNavigate={() => setOpen(false)} />
      </Drawer>
      <main className="main">
        {needsSetup && (
          <div className="banner setup-banner">
            <Icon name="sparkles" size={18} />
            <span className="grow">المحل لسه محتاج تجهيز قبل ما الزباين ياخدوا أدوار.</span>
            <NavLink to="/setup" className="btn sm">كمّل التجهيز</NavLink>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
