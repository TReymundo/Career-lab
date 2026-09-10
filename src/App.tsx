import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from './lib/api.ts';
import { setUILang, useT, useUILang } from './lib/i18n.ts';
import { parseBullets, type Store } from './lib/types.ts';
import Start from './pages/Start.tsx';
import Dashboard from './pages/Dashboard.tsx';
import Jobs from './pages/Jobs.tsx';
import Pipeline from './pages/Pipeline.tsx';
import Contacts from './pages/Contacts.tsx';
import ProfilePage from './pages/Profile.tsx';
import Documents from './pages/Documents.tsx';
import Answers from './pages/Answers.tsx';
import Inbox from './pages/Inbox.tsx';

/**
 * The sidebar only shows what you have reached. Everything else stays out of the way until
 * it would mean something — a first screen full of unexplained tabs is how people bounce.
 */
type T = (en: string, es: string) => string;

const NAV = [
  { to: '/start', icon: '◎', label: (t: T) => t('Start here', 'Empezá acá'), sub: (t: T) => t('The guided path', 'El camino guiado'), unlock: () => true },
  { to: '/profile', icon: '✎', label: (t: T) => t('My CV', 'Mi CV'), sub: (t: T) => t('Everything about you', 'Todo sobre vos'), unlock: (s: Store) => s.experience.length > 0 },
  { to: '/jobs', icon: '⌕', label: (t: T) => t('Jobs', 'Avisos'), sub: (t: T) => t('Import, search, rank', 'Importar, buscar, ordenar'), unlock: (s: Store) => s.experience.some((e) => parseBullets(e.bullets).length > 0) },
  { to: '/documents', icon: '❐', label: (t: T) => t('Documents', 'Documentos'), sub: (t: T) => t('CV, letters, prep', 'CV, cartas, preparación'), unlock: (s: Store) => s.application.length > 0 },
  { to: '/pipeline', icon: '▤', label: (t: T) => t('Pipeline', 'Tablero'), sub: (t: T) => t('Track applications', 'Seguí tus postulaciones'), unlock: (s: Store) => s.application.length > 0 },
  { to: '/answers', icon: '✍', label: (t: T) => t('Answer bank', 'Respuestas'), sub: (t: T) => t('Form answers', 'Respuestas de formularios'), unlock: (s: Store) => s.document.length > 0 },
  { to: '/contacts', icon: '⚇', label: (t: T) => t('Network', 'Contactos'), sub: (t: T) => t('People to follow up', 'Gente a la que seguir'), unlock: (s: Store) => s.application.length > 0 },
  { to: '/dashboard', icon: '◱', label: (t: T) => t('Dashboard', 'Panel'), sub: (t: T) => t('Metrics', 'Métricas'), unlock: (s: Store) => s.application.some((a) => a.status !== 'saved') },
  { to: '/inbox', icon: '✉', label: (t: T) => t('Inbox sync', 'Correo'), sub: (t: T) => t('Recruiter email', 'Mails de reclutadores'), unlock: (s: Store) => s.application.some((a) => a.status === 'applied') },
];

const TITLES: Record<string, (t: T) => { title: string; sub: string }> = {
  '/start': (t) => ({ title: t('Start here', 'Empezá acá'), sub: t('One step at a time. Nothing to figure out.', 'Un paso a la vez. Nada que adivinar.') }),
  '/profile': (t) => ({ title: t('My CV', 'Mi CV'), sub: t('Your history, written once, in one place', 'Tu historia, escrita una vez, en un solo lugar') }),
  '/jobs': (t) => ({ title: t('Jobs', 'Avisos'), sub: t('Bring openings in, search them, generate from them', 'Traé búsquedas, filtralas, generá desde ellas') }),
  '/documents': (t) => ({ title: t('Documents', 'Documentos'), sub: t('Tailored CVs, cover letters, outreach and interview prep', 'CVs a medida, cartas, mensajes y preparación de entrevistas') }),
  '/pipeline': (t) => ({ title: t('Pipeline', 'Tablero'), sub: t('Saved → Tailored → Applied → Interviewing → Offer', 'Guardado → Adaptado → Postulado → Entrevistas → Oferta') }),
  '/answers': (t) => ({ title: t('Answer bank', 'Respuestas'), sub: t('The questions every form asks — write each once', 'Las preguntas que hace todo formulario — escribí cada una una vez') }),
  '/contacts': (t) => ({ title: t('Network', 'Contactos'), sub: t('People, and when to come back to them', 'Gente, y cuándo volver a escribirles') }),
  '/dashboard': (t) => ({ title: t('Dashboard', 'Panel'), sub: t('Where the funnel stands and what is due', 'Cómo va el embudo y qué vence') }),
  '/inbox': (t) => ({ title: t('Inbox sync', 'Correo'), sub: t('Recruiter emails in English and Spanish, proposed not applied', 'Mails de reclutadores en inglés y español, propuestos no aplicados') }),
};

export default function App() {
  const { store, error, reload } = useStore();
  const { pathname } = useLocation();
  const [showAll, setShowAll] = useState(false);
  const t = useT();
  const lang = useUILang();
  const head = (TITLES[pathname] ?? TITLES['/start'])(t);

  if (error) {
    return (
      <div className="grid min-h-full place-items-center p-10">
        <div className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm">
          <p className="mb-2 font-medium text-rose-700">{t('Can’t reach the API.', 'No puedo conectar con la API.')}</p>
          <p className="text-ink-700">{t('Start both processes with', 'Arrancá los dos procesos con')} <code className="rounded bg-white px-1 text-brand-700">npm run dev</code>.</p>
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
          <div className="skeleton h-24 rounded-xl" />
          <div className="skeleton h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  const unlocked = NAV.filter((n) => n.unlock(store));
  const hidden = NAV.length - unlocked.length;
  const visible = showAll ? NAV : unlocked;

  return (
    <div className="flex min-h-full">
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">CL</span>
          <span className="text-[15px] font-semibold tracking-tight">Career<span className="text-brand-600">Lab</span></span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {visible.map((n) => {
            const locked = !n.unlock(store);
            return (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150 ${
                    isActive ? 'bg-brand-50 font-medium text-brand-700 shadow-[inset_2px_0_0_var(--color-brand-600)]'
                             : locked ? 'text-ink-400 hover:bg-sunken' : 'text-ink-700 hover:bg-sunken'}`}
              >
                <span className="w-4 text-center text-base leading-none opacity-70 transition group-hover:opacity-100">{n.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{n.label(t)}</span>
                  <span className="block truncate text-[11px] text-ink-400">{n.sub(t)}</span>
                </span>
                {locked && <span className="text-[10px]">🔒</span>}
              </NavLink>
            );
          })}
        </nav>

        {hidden > 0 && (
          <button onClick={() => setShowAll((v) => !v)} className="px-5 py-2 text-left text-[11px] text-ink-400 transition hover:text-ink-700">
            {showAll ? t('Hide what I haven’t reached', 'Ocultar lo que todavía no usé')
                     : t(`Show ${hidden} more section${hidden > 1 ? 's' : ''} →`, `Ver ${hidden} sección${hidden > 1 ? 'es' : ''} más →`)}
          </button>
        )}

        <div className="border-t border-line px-5 py-4 text-[11px] leading-relaxed text-ink-400">
          {t('Local only. Your data stays in', 'Todo local. Tus datos quedan en')} <code>data/career-lab.db</code>.
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
          <div className="flex items-baseline justify-between gap-6 px-6 py-4 md:px-8">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-ink-900">{head.title}</h1>
              <p className="text-sm text-ink-500">{head.sub}</p>
            </div>
            <div className="flex items-center gap-3">
            <div className="flex overflow-hidden rounded-lg border border-line bg-surface text-xs">
              {(['en', 'es'] as const).map((l) => (
                <button key={l} onClick={() => setUILang(l)}
                        className={`px-2.5 py-1.5 font-medium transition ${lang === l ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-sunken'}`}>
                  {l === 'en' ? 'EN' : 'ES'}
                </button>
              ))}
            </div>
            <nav className="flex gap-1 md:hidden">
              {visible.map((n) => (
                <NavLink key={n.to} to={n.to} title={n.label(t)}
                         className={({ isActive }) => `rounded-md px-2 py-1 text-base ${isActive ? 'bg-brand-100 text-brand-700' : 'text-ink-500'}`}>
                  {n.icon}
                </NavLink>
              ))}
            </nav>
            </div>
          </div>
        </header>

        <main key={pathname} className="animate-rise px-6 py-6 md:px-8">
          <Routes>
            <Route path="/" element={<Navigate to="/start" replace />} />
            <Route path="/start" element={<Start store={store} reload={reload} />} />
            <Route path="/dashboard" element={<Dashboard store={store} />} />
            <Route path="/jobs" element={<Jobs store={store} reload={reload} />} />
            <Route path="/pipeline" element={<Pipeline store={store} reload={reload} />} />
            <Route path="/contacts" element={<Contacts store={store} reload={reload} />} />
            <Route path="/profile" element={<ProfilePage store={store} reload={reload} />} />
            <Route path="/documents" element={<Documents store={store} reload={reload} />} />
            <Route path="/answers" element={<Answers store={store} reload={reload} />} />
            <Route path="/inbox" element={<Inbox store={store} reload={reload} />} />
            <Route path="*" element={<Navigate to="/start" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
