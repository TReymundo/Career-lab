import { useMemo, useState } from 'react';
import { Area, Badge, Button, Card, Empty, Field, Select } from '../components/ui.tsx';
import { api, daysUntil, fmtDate, today } from '../lib/api.ts';
import { LIVE_STATUSES, STATUSES, TRACKS, type Application, type Store, type Track } from '../lib/types.ts';

const tone = (id: string) => STATUSES.find((s) => s.id === id)?.tone ?? 'slate';
const statusLabel = (id: string) => STATUSES.find((s) => s.id === id)?.label ?? id;
const trackShort = (id: string) => TRACKS.find((t) => t.id === id)?.short ?? id;
const PRIORITIES = [{ v: 1, l: 'High' }, { v: 2, l: 'Medium' }, { v: 3, l: 'Low' }];

export default function Pipeline({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('live');
  const [trackFilter, setTrackFilter] = useState('all');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return store.application.filter((a) => {
      if (statusFilter === 'live' && !LIVE_STATUSES.includes(a.status)) return false;
      if (statusFilter !== 'live' && statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (trackFilter !== 'all' && a.track !== trackFilter) return false;
      if (!needle) return true;
      return `${a.company} ${a.role} ${a.location} ${a.notes}`.toLowerCase().includes(needle);
    });
  }, [store.application, q, statusFilter, trackFilter]);

  const add = async () => {
    const created = await api.create<Application>('application', {
      company: 'New target',
      role: '',
      track: (trackFilter === 'all' ? 'markets' : trackFilter) as Track,
      status: 'target',
    });
    await reload();
    setOpenId(created.id);
  };

  const open = store.application.find((a) => a.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field placeholder="Search company, role, notes…" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-56 flex-1" />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
          <option value="live">Live only</option>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
        <Select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)} className="w-52">
          <option value="all">All tracks</option>
          {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Select>
        <Button variant="primary" onClick={add}>+ Target</Button>
      </div>

      {rows.length === 0 ? (
        <Empty>No applications match. Add a target — even a firm you have only heard of counts; the point is to see the funnel.</Empty>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-850 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Company / role</th>
                <th className="px-3 py-2 text-left font-medium">Track</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Next action</th>
                <th className="px-3 py-2 text-right font-medium">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {rows.map((a) => {
                const n = daysUntil(a.next_action_on || a.deadline);
                return (
                  <tr
                    key={a.id}
                    onClick={() => setOpenId(a.id)}
                    className={`cursor-pointer hover:bg-ink-850/60 ${openId === a.id ? 'bg-ink-850/80' : ''}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {a.priority === 1 && <span className="text-accent" title="High priority">★</span>}
                        <span className="font-medium text-slate-100">{a.company}</span>
                      </div>
                      <div className="text-xs text-slate-500">{a.role || '—'}{a.location ? ` · ${a.location}` : ''}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{trackShort(a.track)}</td>
                    <td className="px-3 py-2.5"><Badge tone={tone(a.status)}>{statusLabel(a.status)}</Badge></td>
                    <td className="max-w-64 truncate px-3 py-2.5 text-slate-300">{a.next_action || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                      {n === null ? <span className="text-slate-600">—</span> : (
                        <span className={n < 0 ? 'text-rose-300' : n <= 2 ? 'text-amber-300' : 'text-slate-400'}>
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
  const [draft, setDraft] = useState<Application>(app);
  const [saving, setSaving] = useState(false);
  const [eventNote, setEventNote] = useState('');
  const [eventKind, setEventKind] = useState('note');

  const set = (patch: Partial<Application>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setSaving(true);
    await api.update('application', app.id, draft);
    await reload();
    setSaving(false);
  };

  const remove = async () => {
    if (!confirm(`Delete ${app.company}? Its logged events go with it.`)) return;
    await api.remove('application', app.id);
    await reload();
    close();
  };

  const logEvent = async () => {
    if (!eventNote.trim()) return;
    await api.create('event', { application_id: app.id, kind: eventKind, note: eventNote.trim(), on_date: today() });
    setEventNote('');
    await reload();
  };

  const events = store.event.filter((e) => e.application_id === app.id);
  const contacts = store.contact.filter((c) => c.application_id === app.id);
  const dirty = JSON.stringify(draft) !== JSON.stringify(app);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{draft.company || 'Untitled'}</h2>
          <p className="text-sm text-slate-400">{draft.role || 'Role not set'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}</Button>
          <Button variant="danger" onClick={remove}>Delete</Button>
          <Button variant="ghost" onClick={close}>Close</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3">
          <Field label="Company" value={draft.company} onChange={(e) => set({ company: e.target.value })} />
          <Field label="Role" value={draft.role} onChange={(e) => set({ role: e.target.value })} />
          <Field label="Location" value={draft.location} onChange={(e) => set({ location: e.target.value })} />
          <Select label="Track" value={draft.track} onChange={(e) => set({ track: e.target.value as Track })}>
            {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Status" value={draft.status} onChange={(e) => set({ status: e.target.value as Application['status'] })}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
            <Select label="Priority" value={draft.priority} onChange={(e) => set({ priority: Number(e.target.value) })}>
              {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </Select>
          </div>
        </div>

        <div className="space-y-3">
          <Field
            label="Next action"
            value={draft.next_action}
            onChange={(e) => set({ next_action: e.target.value })}
            placeholder="e.g. message alum on the FX desk"
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Next action on" type="date" value={draft.next_action_on} onChange={(e) => set({ next_action_on: e.target.value })} />
            <Field label="Deadline" type="date" value={draft.deadline} onChange={(e) => set({ deadline: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Applied on" type="date" value={draft.applied_on} onChange={(e) => set({ applied_on: e.target.value })} />
            <Field label="Source" value={draft.source} onChange={(e) => set({ source: e.target.value })} placeholder="referral, careers site…" />
          </div>
          <Field label="Posting URL" value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />
          <Area
            label="Notes"
            rows={4}
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="Comp, team size, what they said on the call, what to ask next time."
          />
        </div>

        <div className="space-y-3">
          <Area
            label="Job description (paste it — the document generator reads it)"
            rows={8}
            value={draft.jd}
            onChange={(e) => set({ jd: e.target.value })}
            placeholder="Paste the full posting here."
          />
          {contacts.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">People here</div>
              <div className="flex flex-wrap gap-1.5">
                {contacts.map((c) => <Badge key={c.id} tone="violet">{c.name}</Badge>)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 border-t border-ink-800 pt-4">
        <div className="mb-2 text-[11px] uppercase tracking-wider text-slate-400">Activity log</div>
        <div className="mb-3 flex gap-2">
          <Select value={eventKind} onChange={(e) => setEventKind(e.target.value)} className="w-36">
            {['note', 'applied', 'email', 'call', 'interview', 'referral', 'offer', 'reject'].map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
          <Field
            value={eventNote}
            onChange={(e) => setEventNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void logEvent(); }}
            placeholder="What happened? (Enter to log)"
            className="flex-1"
          />
          <Button onClick={logEvent}>Log</Button>
        </div>
        {events.length === 0 ? <p className="text-sm text-slate-500">Nothing logged yet.</p> : (
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 text-xs text-slate-500 tabular-nums">{fmtDate(e.on_date)}</span>
                <Badge>{e.kind}</Badge>
                <span className="min-w-0 flex-1 text-slate-300">{e.note}</span>
                <button
                  onClick={async () => { await api.remove('event', e.id); await reload(); }}
                  className="text-xs text-slate-600 hover:text-rose-300"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
