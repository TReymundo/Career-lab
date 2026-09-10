import { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, Field, SectionTitle } from '../components/ui.tsx';
import { api, fmtDate } from '../lib/api.ts';
import { statusMeta, type Store } from '../lib/types.ts';

interface Proposal {
  application_id: number; company: string; role: string; from: string; subject: string;
  date: string; current: string; proposed: string; matched: string; confidence: 'high' | 'medium';
}

export default function Inbox({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const [status, setStatus] = useState<{ configured: boolean; user: string; host: string } | null>(null);
  const [days, setDays] = useState(30);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [rejected, setRejected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [scanned, setScanned] = useState(false);

  useEffect(() => { void api.emailStatus().then(setStatus).catch(() => setStatus({ configured: false, user: '', host: '' })); }, []);

  const scan = async () => {
    setBusy(true); setMsg('');
    try {
      const res = await api.emailScan(days);
      setProposals(res.proposals);
      setScanned(true);
      setMsg(res.proposals.length ? '' : 'Scan finished. Nothing in that window matches an application in your pipeline.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const accepted = proposals.filter((p) => !rejected.has(p.application_id));

  const apply = async () => {
    if (!accepted.length) return;
    setBusy(true);
    await api.emailApply(accepted);
    await reload();
    setProposals([]);
    setRejected(new Set());
    setMsg(`${accepted.length} application${accepted.length > 1 ? 's' : ''} updated, each with an entry in its activity log.`);
    setBusy(false);
  };

  const emailEvents = store.event.filter((e) => e.kind === 'email').slice(0, 8);

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <SectionTitle>Connection</SectionTitle>
        {status === null ? (
          <div className="skeleton h-16 rounded-lg" />
        ) : status.configured ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="emerald">connected</Badge>
            <span className="text-sm text-ink-700">{status.user} · {status.host}</span>
            <div className="ml-auto flex items-end gap-2">
              <Field label="Look back (days)" type="number" value={days} min={1} max={365}
                     onChange={(e) => setDays(Number(e.target.value))} className="w-32" />
              <Button variant="primary" disabled={busy} onClick={scan}>{busy ? 'Scanning…' : 'Scan inbox'}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <Badge tone="amber">not configured</Badge>
            <p className="text-ink-700">
              Scanning reads your mailbox over IMAP. Your password is never entered into this app and never stored in the
              database — put it in a <code className="rounded bg-sunken px-1">.env</code> file next to <code className="rounded bg-sunken px-1">package.json</code>,
              which only the API process on this machine reads:
            </p>
            <pre className="overflow-x-auto rounded-lg border border-line bg-sunken p-3 text-xs text-ink-700">{`IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=you@gmail.com
IMAP_PASSWORD=your-app-password`}</pre>
            <p className="text-ink-500">
              For Gmail use an <strong>app password</strong> (Google Account → Security → 2-Step Verification → App passwords),
              never your account password. Restart <code className="rounded bg-sunken px-1">npm run dev</code> afterwards.
            </p>
          </div>
        )}
        {msg && <p className="mt-3 rounded-lg border border-line bg-sunken px-3 py-2 text-sm text-ink-700">{msg}</p>}
      </Card>

      <div>
        <SectionTitle right={
          proposals.length > 0
            ? <Button variant="primary" disabled={busy || !accepted.length} onClick={apply}>Apply {accepted.length} change{accepted.length === 1 ? '' : 's'}</Button>
            : undefined
        }>
          Proposed status changes
        </SectionTitle>

        {proposals.length === 0 ? (
          <Empty>
            {scanned
              ? 'Nothing to propose. Statuses only move forward, so already-current rows stay untouched.'
              : 'Nothing scanned yet. A scan reads subjects and senders, matches them to companies in your pipeline, and proposes moves — it never applies them on its own.'}
          </Empty>
        ) : (
          <Card className="stagger divide-y divide-line overflow-hidden">
            {proposals.map((p) => {
              const off = rejected.has(p.application_id);
              return (
                <div key={p.application_id} className={`flex items-start gap-4 px-4 py-3 transition ${off ? 'opacity-40' : ''}`}>
                  <input type="checkbox" checked={!off} className="mt-1 accent-brand-600"
                         onChange={() => setRejected((s) => {
                           const n = new Set(s);
                           n.has(p.application_id) ? n.delete(p.application_id) : n.add(p.application_id);
                           return n;
                         })} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink-900">{p.company}</span>
                      <span className="text-sm text-ink-500">{p.role}</span>
                      <Badge tone={statusMeta(p.current).tone}>{statusMeta(p.current).label}</Badge>
                      <span className="text-ink-400">→</span>
                      <Badge tone={statusMeta(p.proposed).tone}>{statusMeta(p.proposed).label}</Badge>
                      {p.confidence === 'medium' && <Badge tone="amber">check this one</Badge>}
                    </div>
                    <p className="mt-1 truncate text-sm text-ink-700">{p.subject}</p>
                    <p className="truncate text-xs text-ink-400">{p.from} · matched “{p.matched}”</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-ink-400">{fmtDate(p.date)}</span>
                </div>
              );
            })}
          </Card>
        )}
        <p className="mt-2 text-xs text-ink-400">
          Rules read English and Spanish. “Gracias por postularte” is treated as an acknowledgement, not a rejection —
          it only ever moves a row to Applied.
        </p>
      </div>

      {emailEvents.length > 0 && (
        <div>
          <SectionTitle>Applied from email</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            {emailEvents.map((e) => {
              const app = store.application.find((a) => a.id === e.application_id);
              return (
                <div key={e.id} className="flex gap-4 px-4 py-2.5 text-sm">
                  <span className="w-24 shrink-0 text-xs tabular-nums text-ink-400">{fmtDate(e.on_date)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-700">{e.note}</span>
                  <span className="shrink-0 text-xs text-ink-400">{app?.company}</span>
                </div>
              );
            })}
          </Card>
        </div>
      )}
    </div>
  );
}
