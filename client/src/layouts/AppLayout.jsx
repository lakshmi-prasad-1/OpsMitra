import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, BrainCircuit, CircleHelp, ClipboardList, LayoutDashboard, LogOut, Menu, Monitor, Moon, Package, Search, Settings, ShoppingCart, Sparkles, Sun, Truck, Users, X, Store, LineChart, MessageSquare } from 'lucide-react';
import { useAuth } from '../context/Auth.jsx';
import { useTheme } from '../context/Theme.jsx';
import { useToast } from '../context/Toast.jsx';
import { api } from '../lib/api.js';
import { initials } from '../lib/format.js';
import CommandPalette from '../components/CommandPalette.jsx';
import Notifications from '../components/Notifications.jsx';
import { Button } from '../components/ui.jsx';

const NAV = [
  ['/app', 'Dashboard', LayoutDashboard, true],
  ['/app/sales', 'Sales', ShoppingCart],
  ['/app/orders', 'Orders', ClipboardList],
  ['/app/inventory', 'Inventory', Package],
  ['/app/customers', 'Customers', Users],
  ['/app/suppliers', 'Suppliers', Truck],
];
const INSIGHT_NAV = [
  ['/app/reports', 'Reports', BarChart3],
  ['/app/insights', 'Insights', BrainCircuit],
  ['/app/assistant', 'Ask OpsMitra', MessageSquare],
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => { setMenuOpen(false); setUserMenu(false); window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => {
    const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!userMenu) return undefined;
    const close = e => { if (!e.target.closest?.('.user-menu')) setUserMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [userMenu]);

  const signOut = async () => { await logout(); navigate('/', { replace: true }); };
  const resetDemo = useCallback(async () => {
    setResetting(true);
    try { await api.post('/demo/reset'); await client.invalidateQueries(); toast.success('Demo data restored to its original state.'); }
    catch (e) { toast.error(e.message); } finally { setResetting(false); }
  }, [client, toast]);

  const business = user.businessName || `${user.name.split(' ')[0]}'s business`;
  const link = ([to, label, Icon, end]) => (
    <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon size={19} /><span>{label}</span></NavLink>
  );

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div className="side-brand">
          <Link to="/app" className="brand-link"><img src="/opsmitra-logo.png" alt="" /><span>OpsMitra</span></Link>
          <button className="icon-btn menu-btn-close" onClick={() => setMenuOpen(false)} aria-label="Close menu" style={{ display: menuOpen ? 'grid' : 'none' }}><X size={20} /></button>
        </div>
        <Link to="/app/settings/business" className="workspace-chip">
          <span className="avatar"><Store size={18} /></span>
          <div><strong>{business}</strong><small>{user.isDemo ? 'Demo workspace' : 'Business workspace'}</small></div>
        </Link>
        <div className="side-section">Operations</div>
        <nav className="side-nav">{NAV.map(link)}</nav>
        <div className="side-section">Intelligence</div>
        <nav className="side-nav">{INSIGHT_NAV.map(link)}</nav>
        <div className="side-section">Account</div>
        <nav className="side-nav">
          {link(['/app/settings', 'Settings', Settings])}
          {link(['/app/help', 'Help & support', CircleHelp])}
        </nav>
        <div className="side-foot">
          {user.isDemo ? (
            <div className="demo-card"><strong>You&apos;re in a demo</strong>Everything here is sample data. Changes are safe to try.<Button variant="secondary" size="sm" className="btn-block" onClick={() => navigate('/register')}>Create your own workspace</Button></div>
          ) : (
            <div className="demo-card"><strong>Ask OpsMitra</strong>Get answers about stock, sales and dues in plain language.<Button variant="secondary" size="sm" className="btn-block" icon={Sparkles} onClick={() => navigate('/app/assistant')}>Try the assistant</Button></div>
          )}
        </div>
      </aside>
      <div className={`scrim ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={22} /></button>
          <button className="topbar-search" onClick={() => setPaletteOpen(true)} aria-label="Search (Ctrl+K)"><Search size={17} /><span>Search products, customers, invoices…</span><kbd>Ctrl K</kbd></button>
          <div className="topbar-actions">
            <button className="icon-btn" aria-label="New sale" title="New sale" onClick={() => navigate('/app/sales/new')}><LineChart size={20} /></button>
            <Notifications />
            <div className="menu user-menu">
              <button className="user-btn" onClick={() => setUserMenu(o => !o)} aria-label="Account menu" aria-expanded={userMenu}><span className="avatar">{initials(user.name)}</span></button>
              {userMenu && (
                <div className="dropdown dropdown-menu" role="menu">
                  <div className="dropdown-user"><strong>{user.name}</strong><small>{user.email}</small></div>
                  <Link to="/app/settings"><Settings size={16} /> Account settings</Link>
                  <div className="side-section" style={{ padding: '10px 12px 4px' }}>Appearance</div>
                  {[['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]].map(([key, label, Icon]) => (
                    <button key={key} onClick={() => setTheme(key)} style={theme === key ? { background: 'var(--brand-soft)', color: 'var(--brand-strong)', fontWeight: 700 } : undefined}><Icon size={16} /> {label}</button>
                  ))}
                  <button onClick={signOut}><LogOut size={16} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        {user.isDemo && (
          <div className="demo-banner no-print">
            <Sparkles size={16} /><span>Demo workspace with 90 days of sample data. Nothing here is real.</span>
            <button className="link" onClick={resetDemo} disabled={resetting}>{resetting ? 'Resetting…' : 'Reset demo data'}</button>
          </div>
        )}
        <main className="content" id="main"><Outlet /></main>
        <footer className="app-foot no-print"><span>OpsMitra · Your Business, Simplified by AI</span><span>Insights are rule-based and forecasts are statistical estimates.</span></footer>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
