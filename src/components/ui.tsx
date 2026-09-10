import { useEffect, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ButtonHTMLAttributes } from 'react';

const base = 'w-full rounded-lg bg-surface border border-line px-3 py-2 text-sm text-ink-900 ' +
  'placeholder:text-ink-400 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100';

export function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-500">{children}</span>;
}

export function Field({ label, className = '', ...rest }: { label?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`block ${className}`}>
      {label && <Label>{label}</Label>}
      <input {...rest} className={base} />
    </label>
  );
}

export function Area({ label, className = '', ...rest }: { label?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className={`block ${className}`}>
      {label && <Label>{label}</Label>}
      <textarea {...rest} className={`${base} resize-y leading-relaxed`} />
    </label>
  );
}

export function Select({ label, className = '', children, ...rest }: { label?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={`block ${className}`}>
      {label && <Label>{label}</Label>}
      <select {...rest} className={`${base} cursor-pointer appearance-none bg-[length:12px] bg-[right_0.7rem_center] bg-no-repeat pr-8`}
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath fill='%235b7268' d='M1 1.5 6 6.5l5-5'/%3E%3C/svg%3E\")" }}>
        {children}
      </select>
    </label>
  );
}

type BtnProps = { variant?: 'primary' | 'ghost' | 'danger' | 'subtle' | 'soft' } & ButtonHTMLAttributes<HTMLButtonElement>;
export function Button({ variant = 'subtle', className = '', ...rest }: BtnProps) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20 font-medium active:scale-[.98]',
    soft: 'bg-brand-100 text-brand-700 hover:bg-brand-200 font-medium active:scale-[.98]',
    subtle: 'bg-surface text-ink-700 hover:bg-sunken border border-line active:scale-[.98]',
    ghost: 'text-ink-500 hover:bg-sunken hover:text-ink-900',
    danger: 'text-rose-600 hover:bg-rose-50 border border-rose-200',
  }[variant];
  return <button {...rest} className={`rounded-lg px-3 py-1.5 text-sm transition-all duration-150 disabled:pointer-events-none disabled:opacity-40 ${styles} ${className}`} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(16_35_26/.04)] ${className}`}>{children}</div>;
}

const TONES: Record<string, string> = {
  slate: 'bg-sunken text-ink-500 border-line',
  green: 'bg-brand-100 text-brand-700 border-brand-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  sky: 'bg-sky-50 text-sky-700 border-sky-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function Badge({ tone = 'slate', children, className = '' }: { tone?: string; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] leading-none ${TONES[tone] ?? TONES.slate} ${className}`}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="animate-fade rounded-xl border border-dashed border-line-strong bg-surface/60 p-10 text-center text-sm text-ink-500">{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-700">{children}</h2>
      {right}
    </div>
  );
}

export function Stat({ label, value, hint, tone = 'green' }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <Card className="card-hover p-4">
      <div className="flex items-start justify-between">
        <div className="text-2xl font-semibold tabular-nums text-ink-900">{value}</div>
        {hint && <Badge tone={tone}>{hint}</Badge>}
      </div>
      <div className="mt-0.5 text-xs text-ink-500">{label}</div>
    </Card>
  );
}

/** Right-hand slide-over used for every detail and AI preview panel. */
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-3xl' }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode;
  children: ReactNode; footer?: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="animate-fade absolute inset-0 bg-ink-900/25 backdrop-blur-[2px]" onClick={onClose} />
      <aside className={`animate-slide-over relative flex h-full w-full ${width} flex-col border-l border-line bg-canvas shadow-2xl`}>
        <header className="flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-ink-900">{title}</h2>
            {subtitle && <p className="truncate text-sm text-ink-500">{subtitle}</p>}
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="border-t border-line bg-surface px-5 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
        checked ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-500 hover:bg-sunken'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded border transition ${checked ? 'border-brand-500 bg-brand-500' : 'border-line-strong'}`} />
      {children}
    </button>
  );
}

/** Horizontal bar list — the one chart shape this dashboard needs, drawn without a library. */
export function BarList({ rows, unit = '' }: { rows: { label: string; value: number; tone?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={r.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="truncate text-ink-700">{r.label}</span>
            <span className="tabular-nums text-ink-500">{r.value}{unit}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sunken">
            <div className="animate-bar h-full rounded-full bg-brand-400" style={{ width: `${(r.value / max) * 100}%`, animationDelay: `${i * 40}ms` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Weekly activity columns. Deliberately plain: counts over time, nothing to decode. */
export function ColumnChart({ rows, height = 96 }: { rows: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {rows.map((r, i) => (
        <div key={r.label} className="group flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] tabular-nums text-ink-400 opacity-0 transition group-hover:opacity-100">{r.value}</span>
          <div
            className="w-full rounded-t-md bg-brand-300 transition-colors group-hover:bg-brand-500"
            style={{ height: `${Math.max(2, (r.value / max) * (height - 26))}px`, animation: `rise .4s ${i * 30}ms cubic-bezier(.22,.9,.3,1) both` }}
          />
          <span className="text-[10px] text-ink-400">{r.label}</span>
        </div>
      ))}
    </div>
  );
}
