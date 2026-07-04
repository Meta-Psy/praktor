import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import Login from './components/Login';
import { WebSocketProvider } from './contexts/WebSocketContext';
import {
  IconDashboard, IconAgents, IconConversations, IconTasks, IconSwarms,
  IconSecrets, IconUser, IconGitHub, IconSun, IconMoon, IconLogout,
  IconProjects, IconPortfolio, IconIntake, IconPlans, IconCatalog,
  IconRadar, IconIntel,
} from './components/icons';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Agents = lazy(() => import('./pages/Agents'));
const Conversations = lazy(() => import('./pages/Conversations'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Secrets = lazy(() => import('./pages/Secrets'));
const Swarms = lazy(() => import('./pages/Swarms'));
const UserProfile = lazy(() => import('./pages/UserProfile'));
const Projects = lazy(() => import('./pages/Projects'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const Intake = lazy(() => import('./pages/Intake'));
const Plans = lazy(() => import('./pages/Plans'));
const Catalog = lazy(() => import('./pages/Catalog'));
const Radar = lazy(() => import('./pages/Radar'));
const Intel = lazy(() => import('./pages/Intel'));

const navItems = [
  { to: '/', label: 'Dashboard', Icon: IconDashboard },
  { to: '/projects', label: 'Projects', Icon: IconProjects },
  { to: '/portfolio', label: 'Portfolio', Icon: IconPortfolio },
  { to: '/intake', label: 'Intake', Icon: IconIntake },
  { to: '/plans', label: 'Plans', Icon: IconPlans },
  { to: '/catalog', label: 'Catalog', Icon: IconCatalog },
  { to: '/radar', label: 'Radar', Icon: IconRadar },
  { to: '/intel', label: 'Intel', Icon: IconIntel },
  { to: '/agents', label: 'Agents', Icon: IconAgents },
  { to: '/conversations', label: 'Conversations', Icon: IconConversations },
  { to: '/tasks', label: 'Scheduled Tasks', Icon: IconTasks },
  { to: '/secrets', label: 'Secrets', Icon: IconSecrets },
  { to: '/swarms', label: 'Swarms', Icon: IconSwarms },
  { to: '/user', label: 'User', Icon: IconUser },
];

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('praktor-theme') as 'dark' | 'light') || 'dark';
  });
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('praktor-theme', theme);
  }, [theme]);

  useEffect(() => {
    fetch('/api/auth/check').then((res) => {
      if (res.status === 204) {
        // No auth configured
        setAuthState('authenticated');
      } else if (res.ok) {
        setAuthState('authenticated');
      } else {
        setAuthState('unauthenticated');
      }
    }).catch(() => {
      setAuthState('unauthenticated');
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const handleLogout = useCallback(async () => {
    await fetch('/api/logout', { method: 'POST' });
    setAuthState('unauthenticated');
  }, []);

  if (authState === 'loading') return null;
  if (authState === 'unauthenticated') {
    return <Login onLogin={() => setAuthState('authenticated')} />;
  }

  return (
    <WebSocketProvider>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Hamburger button (mobile only) */}
      <button
        className="hamburger"
        onClick={() => setSidebarOpen(true)}
        style={{
          display: 'none',
          position: 'fixed',
          top: 12,
          left: 12,
          zIndex: 30,
          width: 40,
          height: 40,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: 'var(--shadow)',
        }}
        aria-label="Open menu"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="5" x2="17" y2="5" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="15" x2="17" y2="15" />
        </svg>
      </button>

      {/* Backdrop (mobile only) */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={closeSidebar}
          style={{
            display: 'none',
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 15,
          }}
        />
      )}

      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`} style={{
        width: 232,
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border)',
        padding: '20px 0',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 20,
      }}>
        {/* Logo */}
        <NavLink to="/" style={{
          padding: '4px 20px 20px',
          borderBottom: '1px solid var(--border)',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textDecoration: 'none',
        }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 128 128">
              <polygon fill="#fff" points="0,8 124,4 128,28 4,32"/>
              <polygon fill="#fff" points="14,40 42,38 28,122 0,124"/>
              <polygon fill="#fff" points="72,36 100,34 86,118 58,120"/>
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Mission Control
          </div>
        </NavLink>

        {/* Navigation */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 8px', flex: 1 }}>
          {navItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={closeSidebar}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 7,
                textDecoration: 'none',
                fontSize: 16,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#fff' : 'var(--text-secondary)',
                background: isActive ? 'var(--accent)' : 'transparent',
              })}
            >
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: '12px 8px 4px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <a
            href="https://github.com/mtzanidakis/praktor"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              borderRadius: 7,
              textDecoration: 'none',
              color: 'var(--text-secondary)',
              fontSize: 16,
              fontWeight: 500,
            }}
          >
            <IconGitHub />
            GitHub
          </a>
          <button
            onClick={toggleTheme}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '8px 12px',
              borderRadius: 7,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 16,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '8px 12px',
              borderRadius: 7,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 16,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <IconLogout />
            Sign out
          </button>
        </div>
      </aside>

      <main className="main-content" style={{
        flex: 1,
        marginLeft: 232,
        padding: 32,
        overflowY: 'auto',
        maxHeight: '100vh',
        minHeight: '100vh',
      }}>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/intake" element={<Intake />} />
            <Route path="/plans" element={<Plans />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/radar" element={<Radar />} />
            <Route path="/intel" element={<Intel />} />
            <Route path="/user" element={<UserProfile />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/conversations" element={<Conversations />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/secrets" element={<Secrets />} />
            <Route path="/swarms" element={<Swarms />} />
          </Routes>
        </Suspense>
      </main>
      </div>
    </WebSocketProvider>
  );
}

export default App;
