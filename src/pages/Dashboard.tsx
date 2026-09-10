import { Link } from 'react-router-dom';
import { Badge, Card, Empty, SectionTitle } from '../components/ui.tsx';
import { daysUntil, fmtDate } from '../lib/api.ts';
import { LIVE_STATUSES, STATUSES, TRACKS, type Store } from '../lib/types.ts';

const tone = (id: string) => STATUSES.find((s) => s.id === id)?.tone ?? 'slate';
const label = (id: string) => STATUSES.find((s) => s.id === id)?.label ?? id;

export default function Dashboard({ store }: { store: Store }) {
  const live = store.application.filter((a) => LIVE_STATUSES.includes(a.status));
  const inProcess = live.filter((a) => ['screen', 'interview', 'final', 'offer'].includes(a.status));

  const due = [
    ...store.application
      .filter((a) => a.next_action_on && LIVE_STATUSES.includes(a.status))
      .map((a) => ({ when: a.next_action_on, what: a.next_action || 'Next step', who: `${a.company} — ${a.role}`, to: '/pipeline' })),
    ...store.application
      .filter((a) => a.deadline && ['target', 'networking'].includes(a.status))
      .map((a) => ({ when: a.deadline, what: 'Application deadline', who: `${a.company} — ${a.role}`, to: '/pipeline' })),
    ...store.contact
      .filter((c) => c.next_touch)
      .map((c) => ({ when: c.next_touch, what: 'Follow up', who: `${c.name}${c.company ? ` · ${c.company}` : ''}`, to: '/contacts' })),
  ].sort((a, b) => a.when.localeCompare(b.when)).slice(0, 8);

  const byStatus = STATUSES.map((s) => ({ ...s, n: store.application.filter((a) => a.status === s.id).length }))
    .filter((s) => s.n > 0);
  const byTrack = TRACKS.map((t) => ({ ...t, n: live.filter((a) => a.track === t.id).length })).filter((t) => t.n > 0);
  const maxTrack = Math.max(1, ...byTrack.map((t) => t.n));

  const stats = [
    { k: 'Live processes', v: live.length },
    { k: 'At interview+', v: inProcess.length },
    { k: 'People in network', v: store.contact.length },
    { k: 'Documents drafted', v: store.document.length },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.k} className="p-4">
            <div className="text-2xl font-semibold tabular-nums">{s.v}</div>
            <div className="mt-0.5 text-xs text-slate-400">{s.k}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <SectionTitle right={<Link to="/pipeline" className="text-xs text-accent hover:underline">Pipeline →</Link>}>
            What’s due
          </SectionTitle>
          {due.length === 0 ? (
            <Empty>Nothing scheduled. Add a target in the pipeline and give it a next action with a date.</Empty>
          ) : (
            <Card className="divide-y divide-ink-800">
              {due.map((d, i) => {
                const n = daysUntil(d.when);
                const t = n === null ? 'slate' : n < 0 ? 'rose' : n <= 2 ? 'amber' : 'slate';
                return (
                  <Link to={d.to} key={i} className="flex items-center gap-4 px-4 py-3 hover:bg-ink-850/60">
                    <div className="w-24 shrink-0 text-xs text-slate-400 tabular-nums">{fmtDate(d.when)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{d.what}</div>
                      <div className="truncate text-xs text-slate-500">{d.who}</div>
                    </div>
                    <Badge tone={t}>{n === null ? '—' : n < 0 ? `${-n}d late` : n === 0 ? 'today' : `in ${n}d`}</Badge>
                  </Link>
                );
              })}
            </Card>
          )}
        </section>

        <section className="space-y-6">
          <div>
            <SectionTitle>Stage mix</SectionTitle>
            {byStatus.length === 0 ? <Empty>No applications yet.</Empty> : (
              <Card className="divide-y divide-ink-800">
                {byStatus.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <Badge tone={s.tone}>{label(s.id)}</Badge>
                    <span className="tabular-nums text-slate-300">{s.n}</span>
                  </div>
                ))}
              </Card>
            )}
          </div>

          <div>
            <SectionTitle>Live by track</SectionTitle>
            {byTrack.length === 0 ? <Empty>Tag your targets by track to see where your effort actually goes.</Empty> : (
              <Card className="space-y-2 p-4">
                {byTrack.map((t) => (
                  <div key={t.id}>
                    <div className="mb-1 flex justify-between text-xs text-slate-400">
                      <span>{t.label}</span><span className="tabular-nums">{t.n}</span>
                    </div>
                    <div className="h-1.5 rounded bg-ink-800">
                      <div className="h-full rounded bg-accent/70" style={{ width: `${(t.n / maxTrack) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>
        </section>
      </div>

      <section>
        <SectionTitle>Recent activity</SectionTitle>
        {store.event.length === 0 ? (
          <Empty>Log calls, coffee chats and interviews on each application — the trail is what you reread before a final round.</Empty>
        ) : (
          <Card className="divide-y divide-ink-800">
            {store.event.slice(0, 6).map((e) => {
              const app = store.application.find((a) => a.id === e.application_id);
              return (
                <div key={e.id} className="flex gap-4 px-4 py-2.5 text-sm">
                  <span className="w-24 shrink-0 text-xs text-slate-500 tabular-nums">{fmtDate(e.on_date)}</span>
                  <Badge tone={tone(app?.status ?? 'target')}>{e.kind}</Badge>
                  <span className="min-w-0 flex-1 truncate text-slate-300">{e.note}</span>
                  <span className="shrink-0 text-xs text-slate-500">{app?.company}</span>
                </div>
              );
            })}
          </Card>
        )}
      </section>
    </div>
  );
}
