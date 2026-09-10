import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge, BarList, Card, ColumnChart, Empty, SectionTitle, Stat } from '../components/ui.tsx';
import { daysUntil, fmtDate } from '../lib/api.ts';
import { LIVE_STATUSES, STATUSES, TRACKS, parseBullets, statusMeta, type Store } from '../lib/types.ts';

const WEEKS = 8;

/** Monday-anchored week buckets, most recent last. */
function weekBuckets(count = WEEKS) {
  const out: { key: string; label: string; start: number; end: number }[] = [];
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime();
  for (let i = count - 1; i >= 0; i--) {
    const start = thisMonday - i * 7 * 86_400_000;
    const d = new Date(start);
    out.push({
      key: String(start),
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      start,
      end: start + 7 * 86_400_000,
    });
  }
  return out;
}

const ts = (iso: string) => {
  const t = Date.parse(`${(iso || '').slice(0, 10)}T00:00:00`);
  return Number.isNaN(t) ? null : t;
};

export default function Dashboard({ store }: { store: Store }) {
  const live = store.application.filter((a) => LIVE_STATUSES.includes(a.status));
  const interviewing = store.application.filter((a) => a.status === 'interviewing' || a.status === 'offer');
  const applied = store.application.filter((a) => a.applied_on);

  // Response rate: of everything actually sent, how much came back as anything but silence.
  const responded = applied.filter((a) => ['interviewing', 'offer', 'rejected'].includes(a.status));
  const responseRate = applied.length ? Math.round((responded.length / applied.length) * 100) : 0;
  const interviewRate = applied.length ? Math.round((interviewing.length / applied.length) * 100) : 0;

  const weeks = useMemo(() => {
    const buckets = weekBuckets();
    return buckets.map((b) => ({
      label: b.label,
      value: store.application.filter((a) => {
        const t = ts(a.applied_on);
        return t !== null && t >= b.start && t < b.end;
      }).length,
    }));
  }, [store.application]);

  const velocity = (weeks.slice(-4).reduce((n, w) => n + w.value, 0) / 4).toFixed(1);

  // Which of your own skill words actually appear in the postings you are chasing.
  const topKeywords = useMemo(() => {
    const mine = new Set(
      [...store.profile.skills.split(/[,;]/), ...store.experience.flatMap((e) => parseBullets(e.bullets).map((b) => b.text))]
        .join(' ').toLowerCase().match(/[a-zà-ÿñ][a-zà-ÿñ+#.]{3,}/g) ?? [],
    );
    const jd = store.application.map((a) => `${a.role} ${a.jd}`).join(' ').toLowerCase();
    const counts = new Map<string, number>();
    for (const w of jd.match(/[a-zà-ÿñ][a-zà-ÿñ+#.]{3,}/g) ?? []) {
      if (!mine.has(w) || w.length < 4) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([label, value]) => ({ label, value }));
  }, [store.application, store.experience, store.profile.skills]);

  const due = [
    ...store.application
      .filter((a) => a.next_action_on && LIVE_STATUSES.includes(a.status))
      .map((a) => ({ when: a.next_action_on, what: a.next_action || 'Next step', who: `${a.company} — ${a.role}`, to: '/pipeline' })),
    ...store.application
      .filter((a) => a.deadline && ['saved', 'tailored'].includes(a.status))
      .map((a) => ({ when: a.deadline, what: 'Application deadline', who: `${a.company} — ${a.role}`, to: '/pipeline' })),
    ...store.contact
      .filter((c) => c.next_touch)
      .map((c) => ({ when: c.next_touch, what: 'Follow up', who: `${c.name}${c.company ? ` · ${c.company}` : ''}`, to: '/contacts' })),
  ].sort((a, b) => a.when.localeCompare(b.when)).slice(0, 7);

  const funnel = STATUSES.map((s) => ({
    label: s.label,
    value: store.application.filter((a) => a.status === s.id).length,
  })).filter((s) => s.value > 0);

  const byTrack = TRACKS.map((t) => ({ label: t.short, value: live.filter((a) => a.track === t.id).length }))
    .filter((t) => t.value > 0);

  return (
    <div className="space-y-8">
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Live processes" value={live.length} />
        <Stat label="At interview or offer" value={interviewing.length} hint={applied.length ? `${interviewRate}% of sent` : undefined} />
        <Stat label="Response rate" value={`${responseRate}%`} hint={`${responded.length}/${applied.length}`} tone={responseRate >= 20 ? 'emerald' : 'amber'} />
        <Stat label="Applications / week" value={velocity} hint="last 4 wks" tone="sky" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-5">
          <SectionTitle right={<span className="text-xs text-ink-400">last {WEEKS} weeks</span>}>Applications sent</SectionTitle>
          {weeks.every((w) => w.value === 0) ? (
            <Empty>Nothing sent yet. A row only counts here once it has an “applied on” date.</Empty>
          ) : (
            <ColumnChart rows={weeks} height={130} />
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle>Funnel</SectionTitle>
          {funnel.length === 0 ? <Empty>No applications yet.</Empty> : <BarList rows={funnel} />}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <SectionTitle right={<Link to="/pipeline" className="text-xs text-brand-600 hover:underline">Pipeline →</Link>}>
            What’s due
          </SectionTitle>
          {due.length === 0 ? (
            <Empty>Nothing scheduled. Give your live applications a next action with a date.</Empty>
          ) : (
            <Card className="stagger divide-y divide-line overflow-hidden">
              {due.map((d, i) => {
                const n = daysUntil(d.when);
                const tone = n === null ? 'slate' : n < 0 ? 'rose' : n <= 2 ? 'amber' : 'slate';
                return (
                  <Link to={d.to} key={i} className="flex items-center gap-4 px-4 py-3 transition hover:bg-brand-50">
                    <div className="w-24 shrink-0 text-xs tabular-nums text-ink-500">{fmtDate(d.when)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink-900">{d.what}</div>
                      <div className="truncate text-xs text-ink-500">{d.who}</div>
                    </div>
                    <Badge tone={tone}>{n === null ? '—' : n < 0 ? `${-n}d late` : n === 0 ? 'today' : `in ${n}d`}</Badge>
                  </Link>
                );
              })}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Live by track</SectionTitle>
            {byTrack.length === 0 ? <Empty>Tag your applications by track.</Empty> : <BarList rows={byTrack} />}
          </Card>
          <Card className="p-5">
            <SectionTitle>Your skills, as the market asks for them</SectionTitle>
            {topKeywords.length === 0 ? (
              <Empty>Paste job descriptions onto your applications to see which of your skills the market keeps naming.</Empty>
            ) : (
              <BarList rows={topKeywords} unit="×" />
            )}
          </Card>
        </div>
      </div>

      <section>
        <SectionTitle>Recent activity</SectionTitle>
        {store.event.length === 0 ? (
          <Empty>Log calls, coffee chats and interviews — the trail is what you reread before a final round.</Empty>
        ) : (
          <Card className="stagger divide-y divide-line overflow-hidden">
            {store.event.slice(0, 7).map((e) => {
              const app = store.application.find((a) => a.id === e.application_id);
              return (
                <div key={e.id} className="flex gap-4 px-4 py-2.5 text-sm">
                  <span className="w-24 shrink-0 text-xs tabular-nums text-ink-400">{fmtDate(e.on_date)}</span>
                  <Badge tone={statusMeta(app?.status ?? 'saved').tone}>{e.kind}</Badge>
                  <span className="min-w-0 flex-1 truncate text-ink-700">{e.note}</span>
                  <span className="shrink-0 text-xs text-ink-400">{app?.company}</span>
                </div>
              );
            })}
          </Card>
        )}
      </section>
    </div>
  );
}
