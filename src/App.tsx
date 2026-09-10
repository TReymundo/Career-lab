import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from './lib/api.ts';
import Dashboard from './pages/Dashboard.tsx';
import Pipeline from './pages/Pipeline.tsx';
import Jobs from './pages/Jobs.tsx';
import Contacts from './pages/Contacts.tsx';
import ProfilePage from './pages/Profile.tsx';
import Documents from './pages/Documents.tsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/jobs', label: 'Jobs' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/contacts', label: 'Network' },
  { to: '/profile', label: 'Master CV' },
  { to: '/documents', label: 'Documents' },
];

export default function App() {
  const { store, error, reload } = useStore();

  if (error) {
    return (
      <div className="p-10 text-sm text-rose-300">
        <p className="mb-2 font-medium">Can’t reach the API.</p>
        <p className="text-slate-400">Is the server running? Start both with <code className="text-accent">npm run dev</code>.</p>
        <pre className="mt-4 text-xs text-slate-500">{error}</pre>
      </div>
    );
  }
  if (!store) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="min-h-full">
      <header className="no-print sticky top-0 z-20 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold tracking-tight">Career<span className="text-accent">Lab</span></span>
          </div>
          <nav className="flex gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm transition ${isActive ? 'bg-ink-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard store={store} />} />
          <Route path="/jobs" element={<Jobs store={store} reload={reload} />} />
          <Route path="/pipeline" element={<Pipeline store={store} reload={reload} />} />
          <Route path="/contacts" element={<Contacts store={store} reload={reload} />} />
          <Route path="/profile" element={<ProfilePage store={store} reload={reload} />} />
          <Route path="/documents" element={<Documents store={store} reload={reload} />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
