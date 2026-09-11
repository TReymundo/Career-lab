import { useState } from 'react';
import { Button } from './ui.tsx';
import { api } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import { renderMarkdown } from '../lib/markdown.ts';

/**
 * A generated document, shown as the page it will be rather than as text in a box.
 * Same renderer as the export, so nothing here is a flattering approximation.
 */
export default function DocPreview({
  title, subtitle, markdown, kind = 'cv', company, name, onClose, footer,
}: {
  title: string;
  subtitle?: string;
  markdown: string;
  kind?: string;
  company?: string;
  name: string;
  onClose: () => void;
  footer?: React.ReactNode;
}) {
  const t = useT();
  const lang = useUILang();
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState('');

  const download = async (format: 'pdf' | 'docx') => {
    setBusy(format);
    try {
      setSaved(await api.exportFile({ markdown, format, kind, company, lang, name }));
    } catch (e) {
      setSaved(e instanceof Error ? e.message : String(e));
    }
    setBusy('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-fade absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-line bg-surface px-6 py-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink-900">{title}</p>
            {subtitle && <p className="truncate text-sm text-ink-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg px-2 py-1 text-ink-400 transition hover:bg-sunken hover:text-ink-900">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto bg-sunken/60 p-6">
          <div
            className="sheet sheet-in mx-auto max-w-[640px] rounded-lg bg-white px-10 py-9 text-[12.5px] leading-relaxed text-ink-900 shadow-xl
                       [&_a]:text-brand-700 [&_h1]:mb-1 [&_h1]:text-2xl [&_h1]:font-bold
                       [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-line [&_h2]:pb-1 [&_h2]:text-[12px] [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-wider
                       [&_li]:mb-1 [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-1"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
          />
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-6 py-4">
          <Button variant="primary" disabled={busy !== ''} onClick={() => download('pdf')}>
            {busy === 'pdf' ? t('Building…', 'Generando…') : t('Download PDF', 'Descargar PDF')}
          </Button>
          <Button variant="soft" disabled={busy !== ''} onClick={() => download('docx')}>
            {busy === 'docx' ? t('Building…', 'Generando…') : t('Download DOCX', 'Descargar DOCX')}
          </Button>
          {saved && <span className="animate-fade text-xs text-brand-700">{saved}</span>}
          <div className="ml-auto flex items-center gap-2">{footer}</div>
        </footer>
      </div>
    </div>
  );
}
