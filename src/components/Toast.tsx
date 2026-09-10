import { useSyncExternalStore } from 'react';

/**
 * Temporary notifications, announced from anywhere without threading props through the tree.
 *
 * They exist to mark a moment — something unlocked, something saved — so they leave on their
 * own. Anything the user must act on belongs on the page, not in a message that disappears.
 */
export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: 'success' | 'info';
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

const emit = () => listeners.forEach((fn) => fn());

export function toast(title: string, body?: string, tone: Toast['tone'] = 'success', ms = 6000) {
  const id = nextId++;
  toasts = [...toasts, { id, title, body, tone }];
  emit();
  setTimeout(() => dismiss(id), ms);
  return id;
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function ToastHost() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  if (!list.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          className={`animate-slide-over pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface px-4 py-3 shadow-lg shadow-ink-900/10 ${
            t.tone === 'success' ? 'border-brand-200' : 'border-line'}`}
        >
          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs text-white ${
            t.tone === 'success' ? 'bg-brand-500' : 'bg-ink-400'}`}>
            {t.tone === 'success' ? '✓' : 'i'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink-900">{t.title}</p>
            {t.body && <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{t.body}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="shrink-0 text-ink-400 transition hover:text-ink-700">✕</button>
        </div>
      ))}
    </div>
  );
}
