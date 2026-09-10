import { Link } from 'react-router-dom';
import { Button, Card } from './ui.tsx';
import { api } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import type { Store } from '../lib/types.ts';

/**
 * The guided path continues on every screen, not just the setup one.
 *
 * Each screen opens with the same shape: what this place is for, the two or three moves worth
 * making, and the way out. It dismisses permanently once you know the screen — a tutorial that
 * will not go away becomes furniture people learn to ignore.
 */
export default function Guide({
  id, store, reload, title, body, points, cta, to, tone = 'brand',
}: {
  id: string;
  store: Store;
  reload: () => Promise<void>;
  title: string;
  body?: string;
  points: string[];
  cta?: string;
  to?: string;
  tone?: 'brand' | 'plain';
}) {
  const t = useT();
  if (store.setting[`guide:${id}`] === 'hidden') return null;

  return (
    <Card className={`animate-rise p-4 ${tone === 'brand' ? 'border-brand-200 bg-brand-50/70' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-500 text-sm text-white">→</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-900">{title}</p>
          {body && <p className="mt-0.5 text-sm text-ink-700">{body}</p>}
          <ul className="mt-2 space-y-1">
            {points.map((p, i) => (
              <li key={i} className="flex gap-2 text-sm text-ink-700">
                <span className="text-brand-500">{i + 1}.</span><span>{p}</span>
              </li>
            ))}
          </ul>
          {cta && to && (
            <Link to={to} className="mt-3 inline-block"><Button variant="primary">{cta}</Button></Link>
          )}
        </div>
        <button
          onClick={async () => { await api.setSetting(`guide:${id}`, 'hidden'); await reload(); }}
          className="shrink-0 text-xs text-ink-400 underline transition hover:text-ink-700"
        >
          {t('Got it', 'Entendido')}
        </button>
      </div>
    </Card>
  );
}
