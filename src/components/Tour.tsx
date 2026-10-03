import { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT, useUILang } from '../lib/i18n.ts';
import { canSpeak, say, stopSpeaking } from '../lib/voice.ts';

/**
 * The welcome tour: the page dims, a spotlight moves to each part that matters, and a voice
 * explains it like a friend showing you around. Shown once; the "?" in the header replays it.
 */

export const TOUR_KEY = 'career-lab-tour-done';

interface Stop { target?: string; en: string; es: string }

const STOPS: Stop[] = [
  { en: 'Hey, welcome to Career Lab! Let me show you around — it takes thirty seconds.', es: '¡Hola, bienvenido a Career Lab! Te muestro todo — son treinta segundos.' },
  { target: 'journey', en: 'This is your path. Four steps, top to bottom. Each one lights up as you finish it.', es: 'Este es tu camino. Cuatro pasos, de arriba a abajo. Cada uno se ilumina cuando lo terminás.' },
  { target: 'step-1', en: 'Step one is your CV. Upload the one you have, or build it by answering questions. Here you will also find the interview — a chat where I get to know you.', es: 'El paso uno es tu CV. Subí el que tenés, o armalo respondiendo preguntas. Acá también está la entrevista — una charla donde te conozco.' },
  { target: 'step-2', en: 'Step two: jobs. Everything from LinkedIn and other sites, in one list, ranked for you. When you like one, press I want to apply.', es: 'Paso dos: los avisos. Todo lo de LinkedIn y otros sitios, en una lista, ordenada para vos. Cuando uno te guste, tocá Quiero postularme.' },
  { target: 'step-3', en: 'Step three: apply. For every job you picked, I write a CV and a cover letter made for it — from your own stories.', es: 'Paso tres: postularte. Para cada aviso que elegiste, escribo un CV y una carta hechos para ese aviso — con tus propias historias.' },
  { target: 'step-4', en: 'Step four: track where every application stands, so nothing slips.', es: 'Paso cuatro: seguí en qué está cada postulación, para que no se te escape nada.' },
  { target: 'ai', en: 'Down here you can see the AI that powers all of this. If it ever gets busy, add another free key and it keeps going.', es: 'Acá abajo ves la IA que mueve todo esto. Si alguna vez se satura, agregá otra clave gratis y sigue andando.' },
  { en: 'Best first move? The interview. A short chat about you — and every letter after it will sound like you. Shall we?', es: '¿La mejor primera jugada? La entrevista. Una charla corta sobre vos — y cada carta después va a sonar a vos. ¿Vamos?' },
];

export default function Tour({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useUILang();
  const navigate = useNavigate();
  const [i, setI] = useState(0);
  const [voice, setVoice] = useState(canSpeak());
  const [box, setBox] = useState<DOMRect | null>(null);
  const stop = STOPS[i];
  const last = i === STOPS.length - 1;

  // Find the spotlit element (if it is on screen) and follow it if the window changes.
  useLayoutEffect(() => {
    const measure = () => {
      const el = stop.target ? document.querySelector(`[data-tour="${stop.target}"]`) : null;
      setBox(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [i, stop.target]);

  useEffect(() => { if (voice) say(`tour-${i + 1}`, stop[lang], lang); else stopSpeaking(); }, [i, voice, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight' && !last) setI(i + 1);
      if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const finish = (to?: string) => {
    stopSpeaking();
    try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* private window */ }
    onClose();
    if (to) navigate(to);
  };

  const pad = 8;
  // The card sits beside the spotlight when there is one, centred otherwise.
  const card: React.CSSProperties = box
    ? { left: Math.min(box.right + 20, window.innerWidth - 400), top: Math.max(16, Math.min(box.top, window.innerHeight - 260)) }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="fixed inset-0 z-[60]">
      {/* The dim, with a hole cut where the spotlight is. */}
      {box ? (
        <div className="tour-spot pointer-events-none absolute rounded-2xl transition-all duration-500 ease-out"
             style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} />
      ) : (
        <div className="animate-fade absolute inset-0 bg-forest-950/70 backdrop-blur-[2px]" />
      )}
      <div className="absolute inset-0" onClick={() => !last && setI(i + 1)} />

      <div key={i} className="page-up absolute w-[360px] max-w-[calc(100vw-32px)] rounded-3xl bg-surface p-6 shadow-2xl" style={card}>
        <div className="flex items-center gap-3">
          <span className={`orb h-10 w-10 shrink-0 rounded-full ${voice ? '' : 'opacity-70'}`} />
          <p className="flex-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-600">{t('Quick tour', 'Recorrido rápido')} · {i + 1}/{STOPS.length}</p>
          {canSpeak() && (
            <button onClick={() => setVoice((v) => !v)} className="rounded-full px-2 py-1 text-sm text-ink-500 hover:bg-sunken" title={voice ? t('Mute', 'Silenciar') : t('Voice on', 'Activar voz')}>
              {voice ? '🔊' : '🔈'}
            </button>
          )}
        </div>
        <p className="mt-4 font-display text-xl leading-snug text-forest-900">{stop[lang]}</p>
        <div className="mt-5 flex items-center gap-1.5">
          {STOPS.map((_, j) => <span key={j} className={`h-1.5 rounded-full transition-all duration-300 ${j === i ? 'w-6 bg-brand-500' : 'w-1.5 bg-line-strong'}`} />)}
        </div>
        <div className="mt-5 flex items-center gap-2">
          {i > 0 && <button onClick={() => setI(i - 1)} className="rounded-full px-3 py-2 text-sm text-ink-500 hover:bg-sunken">←</button>}
          <button onClick={() => finish()} className="text-sm text-ink-400 hover:text-ink-900">{t('Skip', 'Saltear')}</button>
          {last ? (
            <button onClick={() => finish('/story')} className="ml-auto rounded-full bg-forest-900 px-5 py-2.5 text-sm font-semibold text-lime-300 transition hover:bg-forest-800">
              {t('Start the interview →', 'Empezar la entrevista →')}
            </button>
          ) : (
            <button onClick={() => setI(i + 1)} className="ml-auto rounded-full bg-forest-900 px-5 py-2.5 text-sm font-semibold text-lime-300 transition hover:bg-forest-800">
              {i === 0 ? t('Show me', 'Mostrame') : t('Next', 'Siguiente')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
