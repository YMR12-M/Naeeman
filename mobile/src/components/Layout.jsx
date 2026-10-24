/**
 * هيكل التطبيق: شريط فوق فيه «نعيمًا»، والصفحة، وتحتها شريط بلاط فيه
 * أربع زراير (دوري · المحل · سجلّي · حسابي). على الموبايل الشريط ثابت تحت
 * جنب صباع الإيد، وعلى الشاشة الواسعة الصفحة بتتوسّط بعرض موبايل.
 */
import { NavLink, Outlet, Link } from 'react-router-dom';
import { Icon } from '../lib/icons.jsx';
import { lastShop } from '../lib/shop.js';
import { Wordmark } from './brand/index.jsx';

export default function Layout() {
  const shop = lastShop();
  const tabs = [
    { to: '/turn', icon: 'hourglass', label: 'دوري' },
    { to: shop ? `/s/${shop}` : '/', icon: 'scissors', label: 'المحل' },
    { to: '/history', icon: 'list', label: 'سجلّي' },
    { to: '/account', icon: 'user', label: 'حسابي' },
  ];
  return (
    <div className="app">
      <header className="app-bar">
        <Link to="/" aria-label="الرئيسية" className="app-brand"><Wordmark height="1.7rem" /></Link>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <nav className="tabbar tiles" aria-label="التنقّل">
        {tabs.map((tab) => (
          <NavLink key={tab.label} to={tab.to} end={tab.to === '/'}>
            <Icon name={tab.icon} size={22} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
