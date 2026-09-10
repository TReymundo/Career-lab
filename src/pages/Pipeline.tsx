import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, Badge, Button, Card, Drawer, Empty, Field, Select, Toggle } from '../components/ui.tsx';
import { api, daysUntil, fmtDate, today } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import Guide from '../components/Guide.tsx';
import { LIVE_STATUSES, STATUSES, TRACKS, statusMeta, type Application, type Status, type Store, type Track } from '../lib/types.ts';

const trackShort = (id: string) => TRACKS.find((t) => t.id === id)?.short ?? id;
const PRIORITIES = [{ v: 1, l: 'High' }, { v: 2, l: 'Medium' }, { v: 3, l: 'Low' }];

export default function Pipeline({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [openId, setOpenId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [trackFilter, setTrackFilter] = useState('all');
  const [liveOnly, setLiveOnly] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [dragOver, setDragOver] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return store.application.filter((a) => {
      if (liveOnly && !LIVE_STATUSES.includes(a.status)) return false;
      if (trackFilter !== 'all' && a.track !== trackFilter) return false;
      if (!needle) return true;
      return `${a.company} ${a.role} ${a.location} ${a.notes}`.toLowerCase().includes(needle);
    });
  }, [store.application, q, trackFilter, liveOnly]);

  const move = async (id: number, status: Status) => {
    const current = store.application.find((a) => a.id === id);
    if (!current || current.status === status) return;
    await api.update('application', id, { status, ...(status === 'applied' && !current.applied_on ? { applied_on: today() } : {}) });
    await api.create('event', { application_id: id, kind: 'note', on_date: today(), note: `${statusMeta(current.status).label} → ${statusMeta(status).label}` });
    await reload();
  };

  const bulkMove = async (status: Status) => {
    setBusy(true);
    for (const id of checked) await move(id, status);
    setChecked(new Set());
    setBusy(false);
  };

  const add = async () => {
    const created = await api.create<Application>('application', {
      company: 'New target', role: '', track: (trackFilter === 'all' ? 'finance' : trackFilter) as Track, status: 'saved',
    });
    await reload();
    setOpenId(created.id);
  };

  const toggle = (id: number) =>
    setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const open = store.application.find((a) => a.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <Guide
        id="pipeline"
        store={store}
        reload={reload}
        title={t('Where everything you applied to lives', 'Acá vive todo a lo que te postulaste')}
        body={t('Every job you generate documents for lands in Saved. Drag it right as it moves.',
                'Cada aviso para el que generás documentos aparece en Guardado. Arrastralo a la derecha a medida que avanza.')}
        points={[
          t('Saved → Tailored → Applied → Interviewing → Offer or Rejected.',
            'Guardado → Adaptado → Postulado → Entrevistas → Oferta o Rechazo.'),
          t('Open any card and give it a next action with a date — that is what stops things slipping.',
            'Abrí cualquier tarjeta y ponele una próxima acción con fecha — eso es lo que evita que se te escape.'),
          t('Take a backup now and then: the button is at the bottom of this screen.',
            'Hacé una copia de vez en cuando: el botón está al final de esta pantalla.'),
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line bg-surface">
          {(['board', 'list'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
                    className={`px-3 py-1.5 text-sm capitalize transition ${view === v ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-sunken'}`}>
              {v === 'board' ? t('▤ Board', '▤ Tablero') : t('☰ List', '☰ Lista')}
            </button>
          ))}
        </div>
        <Field placeholder={t('Search company, role, notes…', 'Buscar empresa, puesto, notas…')} value={q} onChange={(e) => setQ(e.target.value)} className="min-w-48 max-w-72 flex-1" />
        <Select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)} className="w-48">
          <option value="all">{t('All tracks', 'Todas las áreas')}</option>
          {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Select>
        <Toggle checked={liveOnly} onChange={setLiveOnly}>{t('Live only', 'Sólo activos')}</Toggle>
        <Button variant="primary" className="ml-auto" onClick={add}>{t('+ Application', '+ Postulación')}</Button>
      </div>

      {checked.size > 0 && (
        <Card className="animate-pop flex flex-wrap items-center gap-2 border-brand-200 bg-brand-50 px-4 py-2.5 text-sm">
          <span className="font-medium text-brand-700">{t(`${checked.size} selected`, `${checked.size} seleccionados`)}</span>
          <span className="text-ink-500">{t('move to', 'mover a')}</span>
          {STATUSES.map((s) => (
            <Button key={s.id} disabled={busy} onClick={() => bulkMove(s.id)}>{t(s.label, s.es)}</Button>
          ))}
          <Button variant="ghost" className="ml-auto" onClick={() => setChecked(new Set())}>{t('Clear', 'Limpiar')}</Button>
        </Card>
      )}

      {view === 'board' ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {STATUSES.map((col) => {
            const cards = rows.filter((a) => a.status === col.id);
            return (
              <div
                key={col.id}
                onDragOver={(e) => { e.preventDefault(); setDragOver(col.id); }}
                onDragLeave={() => setDragOver((d) => (d === col.id ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = Number(e.dataTransfer.getData('text/plain'));
                  if (id) void move(id, col.id);
                }}
                className={`flex min-h-64 flex-col rounded-xl border p-2 transition-colors ${
                  dragOver === col.id ? 'border-brand-400 bg-brand-50' : 'border-line bg-sunken/60'}`}
              >
                <div className="flex items-center justify-between px-1.5 py-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{t(col.label, col.es)}</span>
                  <Badge tone={col.tone}>{cards.length}</Badge>
                </div>
                <div className="stagger space-y-2">
                  {cards.map((a) => {
                    const n = daysUntil(a.next_action_on || a.deadline);
                    return (
                      <div
                        key={a.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', String(a.id))}
                        onClick={() => setOpenId(a.id)}
                        className={`card-hover cursor-pointer rounded-lg border bg-surface p-2.5 ${
                          checked.has(a.id) ? 'border-brand-400 ring-2 ring-brand-100' : 'border-line'}`}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={checked.has(a.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggle(a.id)}
                            className="mt-0.5 accent-brand-600"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-ink-900">{a.company}</div>
                            <div className="truncate text-xs text-ink-500">{a.role || t('role TBD', 'puesto a definir')}</div>
                          </div>
                          {a.priority === 1 && <span className="text-brand-500" title="High priority">★</span>}
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <Badge tone="green">{trackShort(a.track)}</Badge>
                          {n !== null && (
                            <Badge tone={n < 0 ? 'rose' : n <= 2 ? 'amber' : 'slate'}>
                              {n < 0 ? `${-n}d late` : n === 0 ? 'today' : `${n}d`}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {cards.length === 0 && (
                    <p className="px-1.5 py-4 text-center text-xs text-ink-400">{t('Drop here', 'Soltá acá')}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : rows.length === 0 ? (
        <Empty>{t('No applications match. Add one, or tick jobs on the Jobs screen and generate from there.', 'No hay postulaciones que coincidan. Agregá una, o marcá avisos en Avisos y generá desde ahí.')}</Empty>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" className="accent-brand-600"
                         checked={checked.size > 0 && checked.size === rows.length}
                         onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((a) => a.id)) : new Set())} />
                </th>
                <th className="px-3 py-2 text-left font-medium">{t('Company / role', 'Empresa / puesto')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('Track', 'Área')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('Status', 'Estado')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('Next action', 'Próxima acción')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Due', 'Vence')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => {
                const n = daysUntil(a.next_action_on || a.deadline);
                return (
                  <tr key={a.id} className={`transition-colors hover:bg-brand-50 ${checked.has(a.id) ? 'bg-brand-50' : ''}`}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={checked.has(a.id)} onChange={() => toggle(a.id)} className="accent-brand-600" />
                    </td>
                    <td className="cursor-pointer px-3 py-2.5" onClick={() => setOpenId(a.id)}>
                      <div className="flex items-center gap-2">
                        {a.priority === 1 && <span className="text-brand-500">★</span>}
                        <span className="font-medium text-ink-900">{a.company}</span>
                      </div>
                      <div className="text-xs text-ink-500">{a.role || '—'}{a.location ? ` · ${a.location}` : ''}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink-500">{trackShort(a.track)}</td>
                    <td className="px-3 py-2.5">
                      <Select value={a.status} onChange={(e) => move(a.id, e.target.value as Status)} className="w-36">
                        {STATUSES.map((s) => <option key={s.id} value={s.id}>{t(s.label, s.es)}</option>)}
                      </Select>
                    </td>
                    <td className="max-w-64 truncate px-3 py-2.5 text-ink-700">{a.next_action || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                      {n === null ? <span className="text-ink-400">—</span> : (
                        <span className={n < 0 ? 'text-rose-600' : n <= 2 ? 'text-amber-600' : 'text-ink-500'}>
                          {fmtDate(a.next_action_on || a.deadline)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {open && <Detail key={open.id} app={open} store={store} reload={reload} close={() => setOpenId(null)} />}

      <BackupBar />
    </div>
  );
}

/** Everything lives in one file on one machine, so this belongs where the value accumulates. */
function BackupBar() {
  const t = useT();
  const [msg, setMsg] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-sm">
      <span className="text-ink-500">
        {t('All of this lives in one file on this computer.', 'Todo esto vive en un archivo en esta computadora.')}
      </span>
      <Button onClick={async () => {
        const res = await fetch('/api/backup');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `career-lab-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        setMsg(t('Downloaded — put it somewhere that is not this laptop.', 'Descargado — guardalo en algún lado que no sea esta computadora.'));
      }}>{t('Download a backup', 'Descargar una copia')}</Button>
      {msg && <span className="animate-fade text-brand-700">{msg}</span>}
    </div>
  );
}

function Detail({ app, store, reload, close }: { app: Application; store: Store; reload: () => Promise<void>; close: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Application>(app);
  const [saving, setSaving] = useState(false);
  const [eventNote, setEventNote] = useState('');
  const [eventKind, setEventKind] = useState('note');

  const set = (patch: Partial<Application>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(app);

  const save = async () => {
    setSaving(true);
    await api.update('application', app.id, draft);
    await reload();
    setSaving(false);
  };

  const logEvent = async () => {
    if (!eventNote.trim()) return;
    await api.create('event', { application_id: app.id, kind: eventKind, note: eventNote.trim(), on_date: today() });
    setEventNote('');
    await reload();
  };

  const events = store.event.filter((e) => e.application_id === app.id);
  const contacts = store.contact.filter((c) => c.application_id === app.id);
  const docs = store.document.filter((d) => d.application_id === app.id);

  return (
    <Drawer
      open
      onClose={close}
      title={draft.company || 'Untitled'}
      subtitle={draft.role || t('Role not set', 'Puesto sin definir')}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>
            {saving ? t('Saving…', 'Guardando…') : dirty ? t('Save changes', 'Guardar cambios') : t('Saved', 'Guardado')}
          </Button>
          <Button variant="soft" onClick={() => navigate(`/documents?app=${app.id}&track=${draft.track}`)}>
            {t('Open in generator →', 'Abrir en el generador →')}
          </Button>
          <Button
            variant="danger"
            className="ml-auto"
            onClick={async () => {
              if (!confirm(`Delete ${app.company}? Its logged events go with it.`)) return;
              await api.remove('application', app.id);
              await reload();
              close();
            }}
          >
            {t('Delete', 'Eliminar')}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Company', 'Empresa')} value={draft.company} onChange={(e) => set({ company: e.target.value })} />
          <Field label={t('Role', 'Puesto')} value={draft.role} onChange={(e) => set({ role: e.target.value })} />
          <Field label={t('Location', 'Ubicación')} value={draft.location} onChange={(e) => set({ location: e.target.value })} />
          <Select label={t('Track', 'Área')} value={draft.track} onChange={(e) => set({ track: e.target.value as Track })}>
            {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
          <Select label={t('Status', 'Estado')} value={draft.status} onChange={(e) => set({ status: e.target.value as Status })}>
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{t(s.label, s.es)}</option>)}
          </Select>
          <Select label={t('Priority', 'Prioridad')} value={draft.priority} onChange={(e) => set({ priority: Number(e.target.value) })}>
            {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Next action', 'Próxima acción')} value={draft.next_action} onChange={(e) => set({ next_action: e.target.value })}
                 placeholder="e.g. message alum on the FX desk" />
          <Field label={t('Next action on', 'Próxima acción el')} type="date" value={draft.next_action_on} onChange={(e) => set({ next_action_on: e.target.value })} />
          <Field label={t('Deadline', 'Fecha límite')} type="date" value={draft.deadline} onChange={(e) => set({ deadline: e.target.value })} />
          <Field label={t('Applied on', 'Me postulé el')} type="date" value={draft.applied_on} onChange={(e) => set({ applied_on: e.target.value })} />
          <Field label={t('Source', 'Origen')} value={draft.source} onChange={(e) => set({ source: e.target.value })} placeholder="referral, careers site…" />
          <Field label={t('Posting URL', 'Link del aviso')} value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />
        </div>

        <Area label={t('Notes', 'Notas')} rows={3} value={draft.notes} onChange={(e) => set({ notes: e.target.value })}
              placeholder="Comp, team size, what they said on the call, what to ask next time." />
        <Area label={t('Job description — the generator and the prep sheet both read this', 'Descripción del aviso — la usan el generador y la hoja de entrevista')} rows={6} value={draft.jd}
              onChange={(e) => set({ jd: e.target.value })} placeholder="Paste the full posting here." />

        {(contacts.length > 0 || docs.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {contacts.map((c) => <Badge key={`c${c.id}`} tone="violet">{c.name}</Badge>)}
            {docs.map((d) => <Badge key={`d${d.id}`} tone="sky">{d.kind}</Badge>)}
          </div>
        )}

        <div className="border-t border-line pt-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-500">{t('Activity log', 'Historial')}</p>
          <div className="mb-3 flex gap-2">
            <Select value={eventKind} onChange={(e) => setEventKind(e.target.value)} className="w-32">
              {['note', 'applied', 'email', 'call', 'interview', 'referral', 'offer', 'reject'].map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
            <Field value={eventNote} onChange={(e) => setEventNote(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') void logEvent(); }}
                   placeholder={t('What happened? (Enter to log)', '¿Qué pasó? (Enter para guardar)')} className="flex-1" />
            <Button onClick={logEvent}>{t('Log', 'Anotar')}</Button>
          </div>
          {events.length === 0 ? <p className="text-sm text-ink-400">{t('Nothing logged yet.', 'Todavía no hay nada.')}</p> : (
            <ul className="space-y-1.5">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-ink-400">{fmtDate(e.on_date)}</span>
                  <Badge>{e.kind}</Badge>
                  <span className="min-w-0 flex-1 text-ink-700">{e.note}</span>
                  <button onClick={async () => { await api.remove('event', e.id); await reload(); }}
                          className="text-xs text-ink-400 hover:text-rose-600">{t('remove', 'quitar')}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  );
}
