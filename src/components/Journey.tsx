import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api, type AiHealth } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import { STEPS, stepIndex, type StepState } from '../lib/journey.ts';

/** The mark: a path rising to a point — the journey, in one line. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="9" fill="var(--color-forest-800)" />
      <path d="M7 23 C 12 23, 12 15, 16 15 S 20 9, 25 9" stroke="var(--color-lime-400)" strokeWidth="2.6" fill="none" strokeLinecap="round"
            className="path-draw" style={{ ['--len' as string]: 40 }} />
      <circle cx="25" cy="9" r="2.8" fill="var(--color-lime-400)" />
    </svg>
  );
}

export function Wordmark({ light = true }: { light?: boolean }) {
  return (
    <span className={`font-display text-[19px] font-semibold ${light ? 'text-white' : 'text-forest-900'}`}>
      career<span className={`italic ${light ? 'text-lime-400' : 'text-brand-600'}`}>lab</span>
    </span>
  );
}

/**
 * The sidebar: the four steps as a path. A step's node fills when it is done, the line to the
 * next one fills behind it, and the step you are on glows. Everything that is not one of the
 * four lives under "More", out of the way.
 */
export default function Journey({ states }: { states: StepState[] }) {
  const t = useT();
  const { pathname } = useLocation();
  const here = stepIndex(pathname);
  const [more, setMore] = useState(() => ['/answers', '/contacts', '/inbox', '/ai', '/profile'].includes(pathname));
  const [health, setHealth] = useState<AiHealth | null>(null);
  useEffect(() => { void api.aiHealth().then(setHealth).catch(() => {}); }, [pathname]);

  const routes = health?.routes ?? [];
  const live = routes.filter((r) => r.ready).length;

  const MORE = [
    { to: '/ai', label: t('AI keys', 'Claves de IA'), icon: '✦' },
    { to: '/answers', label: t('Answer bank', 'Respuestas'), icon: '✍' },
    { to: '/contacts', label: t('Network', 'Contactos'), icon: '⚇' },
    { to: '/inbox', label: t('Inbox sync', 'Correo'), icon: '✉' },
    { to: '/profile', label: t('Advanced CV editor', 'Editor avanzado de CV'), icon: '✎' },
  ];

  return (
    <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-hidden bg-forest-950 text-white md:flex">
      {/* A slow drifting glow, so the dark side has some depth. */}
      <div aria-hidden className="float-slow pointer-events-none absolute -left-24 top-40 h-72 w-72 rounded-full bg-brand-500/15 blur-3xl" />

      <NavLink to="/" className="relative flex items-center gap-2.5 px-6 pb-6 pt-6 transition hover:opacity-85">
        <Logo />
        <Wordmark />
      </NavLink>

      <p className="relative px-6 pb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">{t('Your journey', 'Tu recorrido')}</p>

      <nav className="relative flex-1 px-4">
        <ol data-tour="journey">
          {STEPS.map((s, i) => {
            const st = states[i];
            const active = i === here;
            const last = i === STEPS.length - 1;
            return (
              <li key={s.n} className="relative" data-tour={`step-${s.n}`}>
                {!last && (
                  // The connecting line; it fills lime once this step is done.
                  <span className="absolute left-[27px] top-[46px] h-[calc(100%-34px)] w-0.5 overflow-hidden rounded bg-white/10">
                    <span className="block w-full rounded bg-lime-400 transition-all duration-700 ease-out" style={{ height: st?.done ? '100%' : '0%' }} />
                  </span>
                )}
                <NavLink to={s.to}
                         className={`group relative flex items-start gap-3 rounded-2xl px-2 py-2.5 transition ${active ? 'bg-white/[.07]' : 'hover:bg-white/[.04]'}`}>
                  <span className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold transition-all duration-500 ${
                    st?.done ? 'bg-lime-400 text-forest-950' : active ? 'step-glow bg-forest-800 text-lime-300 ring-2 ring-lime-400' : 'bg-white/[.06] text-white/50 ring-1 ring-white/15 group-hover:text-white/80'}`}>
                    {st?.done ? '✓' : s.n}
                  </span>
                  <span className="min-w-0 pb-4 pt-0.5">
                    <span className={`block text-[15px] font-medium transition ${active ? 'text-white' : 'text-white/75 group-hover:text-white'}`}>{s.label(t)}</span>
                    <span className={`block truncate text-xs ${active || st?.done ? 'text-lime-300/80' : 'text-white/40'}`}>{st?.sub ?? ''}</span>
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ol>

        <div className="mt-4 border-t border-white/10 pt-3">
          <button onClick={() => setMore((m) => !m)} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-white/50 transition hover:text-white">
            <span className={`transition ${more ? 'rotate-90' : ''}`}>▸</span>{t('More', 'Más')}
          </button>
          {more && (
            <div className="animate-fade mt-1 space-y-0.5">
              {MORE.map((m) => (
                <NavLink key={m.to} to={m.to}
                         className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition ${isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/[.05] hover:text-white'}`}>
                  <span className="w-4 text-center opacity-70">{m.icon}</span>{m.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </nav>

      <NavLink to="/ai" data-tour="ai" className="relative mx-4 mb-4 flex items-center gap-2.5 rounded-xl bg-white/[.05] px-3 py-2.5 text-xs text-white/60 transition hover:bg-white/[.09] hover:text-white">
        <span className={`h-2 w-2 rounded-full ${!routes.length ? 'bg-white/30' : live ? 'bg-lime-400 shadow-[0_0_8px] shadow-lime-400' : 'bg-amber-400'}`} />
        <span className="flex-1">
          {!routes.length ? t('No AI connected', 'Sin IA conectada')
            : t(`AI · ${live} of ${routes.length} models ready`, `IA · ${live} de ${routes.length} modelos listos`)}
        </span>
        <span className="text-white/30">→</span>
      </NavLink>
    </aside>
  );
}
