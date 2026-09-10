import { useMemo, useState } from 'react';
import { Badge, Button, Card, Empty } from './ui.tsx';
import { api, fmtDate } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import type { Job } from '../lib/types.ts';

/**
 * Hundreds of postings, grouped by the industry they arrived tagged with.
 *
 * A flat list of five hundred rows is the same as no list at all. Grouping turns the pile
 * into a set of decisions — "nothing in Sales, thirty in Finance" — and every group can be
 * taken or dropped wholesale.
 */
export interface Scored extends Job { score: number }

export default function JobGrid({
  rows, checked, setChecked, onStar, onAdapt, adapting,
}: {
  rows: Scored[];
  checked: Set<number>;
  setChecked: (s: Set<number>) => void;
  onStar: (job: Scored) => void;
  onAdapt: (job: Scored) => void;
  adapting: number | null;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const map = new Map<string, Scored[]>();
    for (const j of rows) {
      const key = j.category?.trim() || t('Uncategorised', 'Sin categoría');
      const list = map.get(key) ?? [];
      list.push(j);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([name, jobs]) => ({ name, jobs: jobs.sort((a, b) => b.score - a.score) }))
      .sort((a, b) => b.jobs.length - a.jobs.length);
  }, [rows, t]);

  const toggle = (id: number) => {
    const next = new Set(checked);
    next.has(id) ? next.delete(id) : next.add(id);
    setChecked(next);
  };

  const toggleGroup = (jobs: Scored[]) => {
    const allOn = jobs.every((j) => checked.has(j.id));
    const next = new Set(checked);
    for (const j of jobs) allOn ? next.delete(j.id) : next.add(j.id);
    setChecked(next);
  };

  if (!rows.length) {
    return (
      <Empty>
        {t('No jobs match. Open “Import jobs” and pull some in — one press brings back hundreds.',
           'No hay avisos que coincidan. Abrí “Importar avisos” y traé algunos — una sola vez trae cientos.')}
      </Empty>
    );
  }

  return (
    <div className="stagger space-y-3">
      {groups.map(({ name, jobs }) => {
        const isCollapsed = collapsed.has(name);
        const selectedHere = jobs.filter((j) => checked.has(j.id)).length;

        return (
          <Card key={name} className="overflow-hidden">
            <div className="flex items-center gap-3 border-b border-line bg-sunken/60 px-4 py-2.5">
              <input
                type="checkbox"
                className="accent-brand-600"
                checked={selectedHere === jobs.length}
                ref={(el) => { if (el) el.indeterminate = selectedHere > 0 && selectedHere < jobs.length; }}
                onChange={() => toggleGroup(jobs)}
                title={t('Select this whole group', 'Seleccionar todo este grupo')}
              />
              <button onClick={() => setCollapsed((c) => {
                const next = new Set(c);
                next.has(name) ? next.delete(name) : next.add(name);
                return next;
              })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="text-ink-400">{isCollapsed ? '▸' : '▾'}</span>
                <span className="truncate text-sm font-semibold text-ink-900">{name}</span>
                <Badge tone="slate">{jobs.length}</Badge>
                {selectedHere > 0 && <Badge tone="green">{selectedHere} {t('selected', 'seleccionados')}</Badge>}
              </button>
            </div>

            {!isCollapsed && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {jobs.map((j) => (
                    <tr key={j.id} className={`transition-colors hover:bg-brand-50 ${checked.has(j.id) ? 'bg-brand-50' : ''}`}>
                      <td className="w-8 py-2.5 pl-4">
                        <input type="checkbox" checked={checked.has(j.id)} onChange={() => toggle(j.id)} className="accent-brand-600" />
                      </td>
                      <td className="max-w-md px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <button onClick={() => onStar(j)} className={j.starred ? 'text-brand-600' : 'text-ink-400 hover:text-brand-600'}>
                            {j.starred ? '★' : '☆'}
                          </button>
                          {j.url
                            ? <a href={j.url} target="_blank" rel="noreferrer" className="truncate font-medium text-ink-900 hover:text-brand-700 hover:underline">{j.title}</a>
                            : <span className="truncate font-medium text-ink-900">{j.title}</span>}
                        </div>
                        <div className="ml-6 truncate text-xs text-ink-500">{j.company}{j.location ? ` · ${j.location}` : ''}</div>
                      </td>
                      <td className="w-16 px-2 py-2.5 text-right tabular-nums">
                        <span className={j.score >= 25 ? 'text-emerald-700' : j.score >= 15 ? 'text-amber-700' : 'text-ink-400'}>{j.score}%</span>
                      </td>
                      <td className="w-24 px-2 py-2.5 text-right text-xs tabular-nums text-ink-400">{j.posted_on ? fmtDate(j.posted_on) : ''}</td>
                      <td className="w-36 px-3 py-2.5 text-right">
                        {j.application_id ? (
                          <Badge tone={j.tailored_at ? 'emerald' : 'sky'}>
                            {j.tailored_at ? t('CV adapted', 'CV adaptado') : t('in pipeline', 'en el tablero')}
                          </Badge>
                        ) : (
                          <Button
                            variant="soft"
                            disabled={adapting !== null}
                            onClick={() => onAdapt(j)}
                          >
                            {adapting === j.id ? t('Adapting…', 'Adaptando…') : t('Adapt CV', 'Adaptar CV')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        );
      })}
    </div>
  );
}
