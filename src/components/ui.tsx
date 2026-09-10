import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ButtonHTMLAttributes } from 'react';

const base = 'w-full rounded-md bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-slate-100 ' +
  'placeholder:text-slate-500 outline-none focus:border-accent/70 focus:ring-1 focus:ring-accent/40 transition';

export function Label({ children }: { children: ReactNode }) {
  return <span className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1">{children}</span>;
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
      <textarea {...rest} className={`${base} leading-relaxed resize-y`} />
    </label>
  );
}

export function Select({ label, className = '', children, ...rest }: { label?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={`block ${className}`}>
      {label && <Label>{label}</Label>}
      <select {...rest} className={`${base} appearance-none cursor-pointer`}>{children}</select>
    </label>
  );
}

type BtnProps = { variant?: 'primary' | 'ghost' | 'danger' | 'subtle' } & ButtonHTMLAttributes<HTMLButtonElement>;
export function Button({ variant = 'subtle', className = '', ...rest }: BtnProps) {
  const styles = {
    primary: 'bg-accent text-ink-950 hover:bg-accent/85 font-medium',
    subtle: 'bg-ink-800 text-slate-200 hover:bg-ink-700 border border-ink-700',
    ghost: 'text-slate-400 hover:text-slate-100 hover:bg-ink-800',
    danger: 'text-rose-300 hover:bg-rose-500/10 border border-rose-500/30',
  }[variant];
  return <button {...rest} className={`rounded-md px-3 py-1.5 text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${styles} ${className}`} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-ink-800 bg-ink-900/70 ${className}`}>{children}</div>;
}

const TONES: Record<string, string> = {
  slate: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  violet: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  sky: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  orange: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rose: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export function Badge({ tone = 'slate', children }: { tone?: string; children: ReactNode }) {
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] leading-none whitespace-nowrap ${TONES[tone] ?? TONES.slate}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-ink-700 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{children}</h2>
      {right}
    </div>
  );
}
