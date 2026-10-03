import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui.tsx';
import { api } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import CVSheet from './CVSheet.tsx';
import { buildCV, detectLang } from '../lib/templates.ts';
import type { Store, Track } from '../lib/types.ts';

/**
 * The moment the CV becomes real.
 *
 * Everything up to here has been typing into boxes, which never feels like progress. This
 * shows the actual page that comes out the other end — the same rendering the PDF uses — and
 * only then points at what happens next. It fires once, ever.
 */
export default function CVReveal({ store, onClose }: { store: Store; onClose: () => void }) {
  const t = useT();
  const lang = useUILang();
  const navigate = useNavigate();
  const [stage, setStage] = useState(0);
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState('');

  const track = (() => {
    try { return (JSON.parse(store.setting['tracks'] || '[]') as Track[])[0] ?? 'other'; } catch { return 'other' as Track; }
  })();
  // The CV's own language, not the app's: a Spanish CV gets Spanish headings.
  const cvLang = detectLang(store.profile, store.experience);
  const markdown = buildCV(store.profile, store.experience, { track, lang: cvLang, template: 'ats' });

  // Three beats: the sheet arrives, the words land, the buttons appear.
  useEffect(() => {
    const timers = [setTimeout(() => setStage(1), 280), setTimeout(() => setStage(2), 900)];
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { timers.forEach(clearTimeout); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const download = async (format: 'pdf' | 'docx') => {
    setBusy(format);
    try {
      const name = await api.exportFile({ markdown, format, kind: 'cv', lang: cvLang, name: store.profile.name });
      setSaved(name);
    } catch (e) {
      setSaved(e instanceof Error ? e.message : String(e));
    }
    setBusy('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />

      {/* Confetti: eight dots, no library, gone in a second and a half. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 14 }).map((_, i) => (
          <span
            key={i}
            className="confetti"
            style={{
              left: `${8 + i * 6.4}%`,
              animationDelay: `${i * 60}ms`,
              background: ['var(--color-brand-400)', 'var(--color-brand-600)', 'var(--color-brand-200)'][i % 3],
            }}
          />
        ))}
      </div>

      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-line bg-surface px-6 py-4">
          <div className={`transition-all duration-500 ${stage >= 1 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}>
            <p className="text-lg font-semibold text-ink-900">
              {t('Your CV is done.', 'Tu CV está listo.')}
            </p>
            <p className="text-sm text-ink-500">
              {t('This is the page an employer receives. Download it, or go and find jobs to aim it at.',
                 'Esta es la página que recibe un empleador. Descargala, o andá a buscar avisos a los que apuntarla.')}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg px-2 py-1 text-ink-400 transition hover:bg-sunken hover:text-ink-900">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto bg-sunken/60 p-6">
          <CVSheet markdown={markdown} className={`sheet ${stage >= 1 ? 'sheet-in' : 'opacity-0'}`} />
        </div>

        <footer className={`flex flex-wrap items-center gap-2 border-t border-line bg-surface px-6 py-4 transition-all duration-500 ${
          stage >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
          <Button variant="primary" disabled={busy !== ''} onClick={() => download('pdf')}>
            {busy === 'pdf' ? t('Building…', 'Generando…') : t('Download PDF', 'Descargar PDF')}
          </Button>
          <Button variant="soft" disabled={busy !== ''} onClick={() => download('docx')}>
            {busy === 'docx' ? t('Building…', 'Generando…') : t('Download DOCX', 'Descargar DOCX')}
          </Button>
          {saved && <span className="animate-fade text-xs text-brand-700">{saved}</span>}
          <Button variant="primary" className="ml-auto" onClick={() => { onClose(); navigate('/jobs'); }}>
            {t('Now find jobs →', 'Ahora buscá avisos →')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
