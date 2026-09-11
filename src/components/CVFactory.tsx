import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Empty, Select } from './ui.tsx';
import DocPreview from './DocPreview.tsx';
import { toast } from './Toast.tsx';
import { api } from '../lib/api.ts';
import { adaptJob } from '../lib/adapt.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import { matchScore, buildCV } from '../lib/templates.ts';
import { TRACKS, type Doc, type Job, type Store, type Track } from '../lib/types.ts';

/**
 * The place a pile of saved jobs becomes a pile of CVs.
 *
 * Everything else in the app is one-at-a-time by nature; this is the one screen that has to
 * work at scale, so selection, progress and results are all built for fifty rows rather than
 * one. Generating in bulk and generating one are the same call underneath.
 */
interface Scored extends Job { score: number }

export default function CVFactory({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const lang = useUILang();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [track, setTrack] = useState<Track>(() => {
    try { return (JSON.parse(store.setting['tracks'] || '[]') as Track[])[0] ?? 'other'; } catch { return 'other'; }
  });
  const [group, setGroup] = useState<'category' | 'match'>('category');
  const [running, setRunning] = useState<{ total: number; done: number; current: string } | null>(null);
  const [failed, setFailed] = useState<{ company: string; error: string }[]>([]);
  const [preview, setPreview] = useState<{ title: string; subtitle: string; markdown: string; company: string } | null>(null);

  const load = async () => {
    const res = await api.searchJobs({ limit: 800 });
    setJobs(res.rows);
  };
  useEffect(() => { void load(); }, [store.application.length, store.document.length]);

  const cvText = useMemo(
    () => buildCV(store.profile, store.experience, { track, lang, template: 'ats', maxBullets: 99 }),
    [store.profile, store.experience, track, lang],
  );

  const pending: Scored[] = useMemo(
    () => jobs
      .filter((j) => !j.application_id && !j.dismissed)
      .map((j) => ({ ...j, score: matchScore(`${j.title} ${j.description}`, cvText) }))
      .sort((a, b) => b.starred - a.starred || b.score - a.score),
    [jobs, cvText],
  );

  const generated = useMemo(
    () => store.document.filter((d) => d.kind === 'cv' && d.application_id).slice(0, 60),
    [store.document],
  );

  const groups = useMemo(() => {
    if (group === 'match') {
      const band = (s: number) => (s >= 25 ? t('Strong match', 'Coincidencia alta')
        : s >= 15 ? t('Worth a look', 'Vale una mirada') : t('Long shot', 'Poco probable'));
      const map = new Map<string, Scored[]>();
      for (const j of pending) {
        const k = band(j.score);
        map.set(k, [...(map.get(k) ?? []), j]);
      }
      return [...map.entries()].map(([name, rows]) => ({ name, rows }));
    }
    const map = new Map<string, Scored[]>();
    for (const j of pending) {
      const k = j.category?.trim() || t('Uncategorised', 'Sin categoría');
      map.set(k, [...(map.get(k) ?? []), j]);
    }
    return [...map.entries()].map(([name, rows]) => ({ name, rows })).sort((a, b) => b.rows.length - a.rows.length);
  }, [pending, group, t]);

  const toggle = (id: number) =>
    setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleMany = (rows: Scored[]) =>
    setChecked((s) => {
      const n = new Set(s);
      const allOn = rows.every((r) => n.has(r.id));
      for (const r of rows) allOn ? n.delete(r.id) : n.add(r.id);
      return n;
    });

  /** One job or fifty — the same call, run in sequence so a failure is attributable. */
  const generate = async (targets: Scored[], openWhenSingle = false) => {
    if (!targets.length) return;
    setFailed([]);
    setRunning({ total: targets.length, done: 0, current: targets[0].company });
    let first: { title: string; subtitle: string; markdown: string; company: string } | null = null;
    const errors: { company: string; error: string }[] = [];

    for (const [i, job] of targets.entries()) {
      setRunning({ total: targets.length, done: i, current: `${job.company} · ${job.title}` });
      // Google's free tier counts requests per minute, so a batch paces itself rather than
      // sprinting into a wall of 429s halfway down the list.
      if (i > 0) await new Promise((r) => setTimeout(r, 4500));
      try {
        const r = await adaptJob({ job, store, track, lang });
        first ??= { title: `${r.company} — ${r.title}`, subtitle: r.why, markdown: r.markdown, company: r.company };
      } catch (e) {
        errors.push({ company: job.company, error: e instanceof Error ? e.message : String(e) });
      }
    }

    setRunning(null);
    setChecked(new Set());
    setFailed(errors);
    await Promise.all([load(), reload()]);

    const ok = targets.length - errors.length;
    if (ok > 0) {
      toast(
        t(`${ok} CV${ok === 1 ? '' : 's'} written`, `${ok} CV${ok === 1 ? '' : 's'} escrito${ok === 1 ? '' : 's'}`),
        t('Each one is filed under Documents and its job moved onto the board as Tailored.',
          'Cada uno quedó en Documentos y su aviso pasó al tablero como Adaptado.'),
      );
    }
    if (openWhenSingle && first) setPreview(first);
  };

  const openDoc = (d: Doc) => {
    const app = store.application.find((a) => a.id === d.application_id);
    setPreview({
      title: d.title,
      subtitle: app ? `${app.company} — ${app.role}` : '',
      markdown: d.body,
      company: app?.company ?? '',
    });
  };

  if (!pending.length && !generated.length) {
    return (
      <Empty>
        {t('No saved jobs yet. Import some on the Jobs screen and they queue up here.',
           'Todavía no hay avisos guardados. Importá algunos en Avisos y aparecen acá en la fila.')}
        <div className="mt-3"><Link to="/jobs"><Button variant="primary">{t('Go to Jobs', 'Ir a Avisos')}</Button></Link></div>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      {preview && (
        <DocPreview
          {...preview}
          name={store.profile.name}
          onClose={() => setPreview(null)}
          footer={<Link to="/documents"><Button>{t('All documents', 'Todos los documentos')}</Button></Link>}
        />
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-2xl font-semibold text-ink-900">
              {t(`${pending.length} jobs waiting for a CV`, `${pending.length} avisos esperando un CV`)}
            </p>
            <p className="mt-0.5 text-sm text-ink-500">
              {t('Tick what you want and write them all at once, or do them one at a time. Each CV is rewritten around that employer.',
                 'Marcá lo que quieras y escribilos todos juntos, o de a uno. Cada CV se reescribe alrededor de esa empresa.')}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select label={t('Framing', 'Enfoque')} value={track} onChange={(e) => setTrack(e.target.value as Track)} className="w-44">
              {TRACKS.map((tr) => <option key={tr.id} value={tr.id}>{tr.label}</option>)}
            </Select>
            <Select label={t('Group by', 'Agrupar por')} value={group} onChange={(e) => setGroup(e.target.value as 'category' | 'match')} className="w-40">
              <option value="category">{t('Industry', 'Industria')}</option>
              <option value="match">{t('Match', 'Afinidad')}</option>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              className="accent-brand-600"
              checked={checked.size > 0 && checked.size === pending.length}
              ref={(el) => { if (el) el.indeterminate = checked.size > 0 && checked.size < pending.length; }}
              onChange={(e) => setChecked(e.target.checked ? new Set(pending.map((j) => j.id)) : new Set())}
            />
            {checked.size ? t(`${checked.size} selected`, `${checked.size} seleccionados`) : t('Select all', 'Seleccionar todo')}
          </label>
          <Button onClick={() => setChecked(new Set(pending.filter((j) => j.starred).map((j) => j.id)))}>
            {t('Only starred', 'Sólo favoritos')}
          </Button>
          <Button onClick={() => setChecked(new Set(pending.filter((j) => j.score >= 20).slice(0, 25).map((j) => j.id)))}>
            {t('Best 25 matches', 'Las 25 mejores')}
          </Button>

          <Button
            variant="primary"
            className="ml-auto"
            disabled={!checked.size || running !== null}
            onClick={() => generate(pending.filter((j) => checked.has(j.id)))}
          >
            {running
              ? t(`Writing ${running.done + 1} of ${running.total}…`, `Escribiendo ${running.done + 1} de ${running.total}…`)
              : t(`Write ${checked.size || ''} CVs`, `Escribir ${checked.size || ''} CVs`)}
          </Button>
        </div>

        {running && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-brand-500 transition-all duration-300"
                   style={{ width: `${(running.done / running.total) * 100}%` }} />
            </div>
            <p className="mt-1.5 truncate text-xs text-ink-500">
              {running.current}
              <span className="ml-2 text-ink-400">
                {t('· paced to stay inside Google’s free-tier limit', '· pausado para no pasar el límite gratuito de Google')}
              </span>
            </p>
          </div>
        )}

        {failed.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">{t(`${failed.length} did not go through`, `${failed.length} no salieron`)}</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {failed.slice(0, 4).map((f, i) => <li key={i}>{f.company}: {f.error}</li>)}
            </ul>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          {groups.map(({ name, rows }) => {
            const on = rows.filter((r) => checked.has(r.id)).length;
            return (
              <Card key={name} className="overflow-hidden">
                <div className="flex items-center gap-3 border-b border-line bg-sunken/60 px-4 py-2">
                  <input
                    type="checkbox"
                    className="accent-brand-600"
                    checked={on === rows.length}
                    ref={(el) => { if (el) el.indeterminate = on > 0 && on < rows.length; }}
                    onChange={() => toggleMany(rows)}
                  />
                  <span className="truncate text-sm font-semibold text-ink-900">{name}</span>
                  <Badge tone="slate">{rows.length}</Badge>
                  {on > 0 && <Badge tone="green">{on}</Badge>}
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {rows.slice(0, 40).map((j) => (
                      <tr key={j.id} className={`transition-colors hover:bg-brand-50 ${checked.has(j.id) ? 'bg-brand-50' : ''}`}>
                        <td className="w-8 py-2 pl-4">
                          <input type="checkbox" checked={checked.has(j.id)} onChange={() => toggle(j.id)} className="accent-brand-600" />
                        </td>
                        <td className="max-w-sm px-3 py-2">
                          <div className="truncate font-medium text-ink-900">{j.starred ? '★ ' : ''}{j.title}</div>
                          <div className="truncate text-xs text-ink-500">{j.company}{j.location ? ` · ${j.location}` : ''}</div>
                        </td>
                        <td className="w-14 px-2 py-2 text-right text-xs tabular-nums text-ink-400">{j.score}%</td>
                        <td className="w-32 px-3 py-2 text-right">
                          <Button variant="soft" disabled={running !== null} onClick={() => generate([j], true)}>
                            {t('Write CV', 'Escribir CV')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {rows.length > 40 && (
                      <tr><td colSpan={4} className="px-4 py-2 text-xs text-ink-400">
                        {t(`+${rows.length - 40} more in this group`, `+${rows.length - 40} más en este grupo`)}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>

        <Card className="p-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-500">
            {t(`Written — ${generated.length}`, `Escritos — ${generated.length}`)}
          </p>
          {generated.length === 0 ? (
            <p className="text-sm text-ink-500">
              {t('Nothing written yet. Anything you generate appears here to open and download.',
                 'Todavía nada. Lo que generes aparece acá para abrir y descargar.')}
            </p>
          ) : (
            <ul className="space-y-1">
              {generated.map((d) => (
                <li key={d.id}>
                  <button onClick={() => openDoc(d)}
                          className="w-full truncate rounded-lg px-2 py-1.5 text-left text-sm text-ink-700 transition hover:bg-brand-50 hover:text-brand-800">
                    {d.title.replace(/^CV — /, '')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
