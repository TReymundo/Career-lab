import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, Badge, Button, Card, Drawer, Empty, Field, Select, Toggle } from '../components/ui.tsx';
import { api, daysUntil, fmtDate, today } from '../lib/api.ts';
import { LIVE_STATUSES, STATUSES, TRACKS, statusMeta, type Application, type Status, type Store, type Track } from '../lib/types.ts';

const trackShort = (id: string) => TRACKS.find((t) => t.id === id)?.short ?? id;
const PRIORITIES = [{ v: 1, l: 'High' }, { v: 2, l: 'Medium' }, { v: 3, l: 'Low' }];

export default function Pipeline({ store, reload }: { store: Store; reload: () => Promise<void> }) {
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line bg-surface">
          {(['board', 'list'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
                    className={`px-3 py-1.5 text-sm capitalize transition ${view === v ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-sunken'}`}>
              {v === 'board' ? '▤ Board' : '☰ List'}
            </button>
          ))}
        </div>
        <Field placeholder="Search company, role, notes…" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-48 max-w-72 flex-1" />
        <Select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)} className="w-48">
          <option value="all">All tracks</option>
          {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Select>
        <Toggle checked={liveOnly} onChange={setLiveOnly}>Live only</Toggle>
        <Button variant="primary" className="ml-auto" onClick={add}>+ Application</Button>
      </div>

      {checked.size > 0 && (
        <Card className="animate-pop flex flex-wrap items-center gap-2 border-brand-200 bg-brand-50 px-4 py-2.5 text-sm">
          <span className="font-medium text-brand-700">{checked.size} selected</span>
          <span className="text-ink-500">move to</span>
          {STATUSES.map((s) => (
            <Button key={s.id} disabled={busy} onClick={() => bulkMove(s.id)}>{s.label}</Button>
          ))}
          <Button variant="ghost" className="ml-auto" onClick={() => setChecked(new Set())}>Clear</Button>
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
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{col.label}</span>
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
                            <div className="truncate text-xs text-ink-500">{a.role || 'role TBD'}</div>
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
                    <p className="px-1.5 py-4 text-center text-xs text-ink-400">Drop here</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : rows.length === 0 ? (
        <Empty>No applications match. Add one, or check jobs on the Jobs screen and generate from there.</Empty>
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
                <th className="px-3 py-2 text-left font-medium">Company / role</th>
                <th className="px-3 py-2 text-left font-medium">Track</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Next action</th>
                <th className="px-3 py-2 text-right font-medium">Due</th>
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
                        {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
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
    </div>
  );
}

function Detail({ app, store, reload, close }: { app: Application; store: Store; reload: () => Promise<void>; close: () => void }) {
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
      subtitle={draft.role || 'Role not set'}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</Button>
          <Button variant="soft" onClick={() => navigate(`/documents?app=${app.id}&track=${draft.track}`)}>Open in generator →</Button>
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
            Delete
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company" value={draft.company} onChange={(e) => set({ company: e.target.value })} />
          <Field label="Role" value={draft.role} onChange={(e) => set({ role: e.target.value })} />
          <Field label="Location" value={draft.location} onChange={(e) => set({ location: e.target.value })} />
          <Select label="Track" value={draft.track} onChange={(e) => set({ track: e.target.value as Track })}>
            {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
          <Select label="Status" value={draft.status} onChange={(e) => set({ status: e.target.value as Status })}>
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          <Select label="Priority" value={draft.priority} onChange={(e) => set({ priority: Number(e.target.value) })}>
            {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Next action" value={draft.next_action} onChange={(e) => set({ next_action: e.target.value })}
                 placeholder="e.g. message alum on the FX desk" />
          <Field label="Next action on" type="date" value={draft.next_action_on} onChange={(e) => set({ next_action_on: e.target.value })} />
          <Field label="Deadline" type="date" value={draft.deadline} onChange={(e) => set({ deadline: e.target.value })} />
          <Field label="Applied on" type="date" value={draft.applied_on} onChange={(e) => set({ applied_on: e.target.value })} />
          <Field label="Source" value={draft.source} onChange={(e) => set({ source: e.target.value })} placeholder="referral, careers site…" />
          <Field label="Posting URL" value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />
        </div>

        <Area label="Notes" rows={3} value={draft.notes} onChange={(e) => set({ notes: e.target.value })}
              placeholder="Comp, team size, what they said on the call, what to ask next time." />
        <Area label="Job description — the generator and the prep sheet both read this" rows={6} value={draft.jd}
              onChange={(e) => set({ jd: e.target.value })} placeholder="Paste the full posting here." />

        {(contacts.length > 0 || docs.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {contacts.map((c) => <Badge key={`c${c.id}`} tone="violet">{c.name}</Badge>)}
            {docs.map((d) => <Badge key={`d${d.id}`} tone="sky">{d.kind}</Badge>)}
          </div>
        )}

        <div className="border-t border-line pt-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-500">Activity log</p>
          <div className="mb-3 flex gap-2">
            <Select value={eventKind} onChange={(e) => setEventKind(e.target.value)} className="w-32">
              {['note', 'applied', 'email', 'call', 'interview', 'referral', 'offer', 'reject'].map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
            <Field value={eventNote} onChange={(e) => setEventNote(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') void logEvent(); }}
                   placeholder="What happened? (Enter to log)" className="flex-1" />
            <Button onClick={logEvent}>Log</Button>
          </div>
          {events.length === 0 ? <p className="text-sm text-ink-400">Nothing logged yet.</p> : (
            <ul className="space-y-1.5">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-ink-400">{fmtDate(e.on_date)}</span>
                  <Badge>{e.kind}</Badge>
                  <span className="min-w-0 flex-1 text-ink-700">{e.note}</span>
                  <button onClick={async () => { await api.remove('event', e.id); await reload(); }}
                          className="text-xs text-ink-400 hover:text-rose-600">remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  );
}
