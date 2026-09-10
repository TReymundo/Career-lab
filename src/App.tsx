import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { daysUntil, useStore } from './lib/api.ts';
import { LIVE_STATUSES } from './lib/types.ts';
import Dashboard from './pages/Dashboard.tsx';
import Jobs from './pages/Jobs.tsx';
import Pipeline from './pages/Pipeline.tsx';
import Contacts from './pages/Contacts.tsx';
import ProfilePage from './pages/Profile.tsx';
import Documents from './pages/Documents.tsx';
import Inbox from './pages/Inbox.tsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '◱', hint: 'Metrics and what is due' },
  { to: '/jobs', label: 'Jobs', icon: '⌕', hint: 'Import, search, rank, generate' },
  { to: '/pipeline', label: 'Pipeline', icon: '▤', hint: 'Kanban and list' },
  { to: '/contacts', label: 'Network', icon: '⚇', hint: 'People and follow-ups' },
  { to: '/profile', label: 'Master CV', icon: '✎', hint: 'Bilingual source of truth' },
  { to: '/documents', label: 'Documents', icon: '❐', hint: 'CV, letters, outreach, prep' },
  { to: '/inbox', label: 'Inbox sync', icon: '✉', hint: 'Recruiter email scanning' },
];

const TITLES: Record<string, { title: string; sub: string }> = {
  '/dashboard': { title: 'Dashboard', sub: 'Where the funnel stands and what is due next' },
  '/jobs': { title: 'Jobs', sub: 'Import from LinkedIn or a public board, search, rank, generate' },
  '/pipeline': { title: 'Pipeline', sub: 'Saved → Tailored → Applied → Interviewing → Offer' },
  '/contacts': { title: 'Network', sub: 'Referrals move these processes more than applications do' },
  '/profile': { title: 'Master CV', sub: 'Type your history once, in both languages, tag it by track' },
  '/documents': { title: 'Documents', sub: 'Tailored CVs, cover letters, outreach and interview prep' },
  '/inbox': { title: 'Inbox sync', sub: 'Recruiter emails in English and Spanish, proposed not applied' },
};

export default function App() {
  const { store, error, reload } = useStore();
  const { pathname } = useLocation();
  const head = TITLES[pathname] ?? TITLES['/dashboard'];

  if (error) {
    return (
      <div className="grid min-h-full place-items-center p-10">
        <div className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm">
          <p className="mb-2 font-medium text-rose-700">Can’t reach the API.</p>
          <p className="text-ink-700">Start both processes with <code className="rounded bg-white px-1 text-brand-700">npm run dev</code>.</p>
          <pre className="mt-3 overflow-x-auto text-xs text-ink-500">{error}</pre>
        </div>
      </div>
    );
  }

  if (!store) {
    return (
      <div className="flex min-h-full">
        <div className="w-60 border-r border-line bg-surface" />
        <div className="flex-1 space-y-4 p-8">
          <div className="skeleton h-8 w-56 rounded-lg" />
          <div className="grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
          </div>
          <div className="skeleton h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  // Small counters in the sidebar, so the nav says what needs attention without opening it.
  const live = store.application.filter((a) => LIVE_STATUSES.includes(a.status));
  const dueNow = [
    ...store.application.filter((a) => LIVE_STATUSES.includes(a.status) && (daysUntil(a.next_action_on) ?? 99) <= 0),
    ...store.contact.filter((c) => (daysUntil(c.next_touch) ?? 99) <= 0),
  ].length;
  const counts: Record<string, number> = {
    '/pipeline': live.length,
    '/contacts': store.contact.length,
    '/documents': store.document.length,
    '/dashboard': dueNow,
  };

  return (
    <div className="flex min-h-full">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">CL</span>
          <span className="text-[15px] font-semibold tracking-tight">Career<span className="text-brand-600">Lab</span></span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={n.hint}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150 ${
                  isActive
                    ? 'bg-brand-50 font-medium text-brand-700 shadow-[inset_2px_0_0_var(--color-brand-600)]'
                    : 'text-ink-700 hover:bg-sunken'}`}
            >
              <span className="w-4 text-center text-base leading-none opacity-70 transition group-hover:opacity-100">{n.icon}</span>
              <span className="flex-1">{n.label}</span>
              {counts[n.to] > 0 && (
                <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] tabular-nums text-ink-500 group-hover:bg-white">
                  {counts[n.to]}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line px-5 py-4 text-[11px] leading-relaxed text-ink-400">
          Local only. Your data sits in <code>data/career-lab.db</code> and never leaves this machine.
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
          <div className="flex items-baseline justify-between gap-6 px-6 py-4 md:px-8">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-ink-900">{head.title}</h1>
              <p className="text-sm text-ink-500">{head.sub}</p>
            </div>
            <nav className="flex gap-1 md:hidden">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} title={n.label}
                         className={({ isActive }) => `rounded-md px-2 py-1 text-base ${isActive ? 'bg-brand-100 text-brand-700' : 'text-ink-500'}`}>
                  {n.icon}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        <main key={pathname} className="animate-rise px-6 py-6 md:px-8">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard store={store} />} />
            <Route path="/jobs" element={<Jobs store={store} reload={reload} />} />
            <Route path="/pipeline" element={<Pipeline store={store} reload={reload} />} />
            <Route path="/contacts" element={<Contacts store={store} reload={reload} />} />
            <Route path="/profile" element={<ProfilePage store={store} reload={reload} />} />
            <Route path="/documents" element={<Documents store={store} reload={reload} />} />
            <Route path="/inbox" element={<Inbox store={store} reload={reload} />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
