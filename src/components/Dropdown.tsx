import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A button that opens a small panel. Filters live in these instead of rows of tags, so the
 * page shows only what is chosen — never every option at once.
 */
export default function Dropdown({ label, value, active = false, children, align = 'left', width = 'w-64' }: {
  label: string; value?: string; active?: boolean; children: ReactNode | ((close: () => void) => ReactNode); align?: 'left' | 'right'; width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                active ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-line bg-surface text-ink-700 hover:border-line-strong'} ${open ? 'ring-4 ring-brand-100' : ''}`}>
        <span className="text-ink-500">{label}</span>
        {value && <span className="max-w-40 truncate font-medium text-ink-900">{value}</span>}
        <span className={`text-[10px] text-ink-400 transition ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && (
        <div className={`dropdown-in absolute z-30 mt-2 ${width} ${align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'} rounded-2xl border border-line bg-surface p-2 shadow-xl shadow-forest-900/10`}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

/** One row inside a dropdown: a radio or a checkbox, styled the same. */
export function Option({ on, onClick, children, count, multi = false }: { on: boolean; onClick: () => void; children: ReactNode; count?: number; multi?: boolean }) {
  return (
    <button onClick={onClick}
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition ${on ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-sunken'}`}>
      <span className={`grid h-4 w-4 shrink-0 place-items-center ${multi ? 'rounded' : 'rounded-full'} border text-[9px] ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong'}`}>
        {on ? '✓' : ''}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="tabular-nums text-xs text-ink-400">{count}</span>}
    </button>
  );
}
