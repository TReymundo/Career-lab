import { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, Field, SectionTitle } from '../components/ui.tsx';
import { api, fmtDate } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import { statusMeta, type Store } from '../lib/types.ts';

interface Proposal {
  application_id: number; company: string; role: string; from: string; subject: string;
  date: string; current: string; proposed: string; matched: string; confidence: 'high' | 'medium';
}

export default function Inbox({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
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
      setMsg(res.proposals.length ? '' : t('Scan finished. Nothing in that window matches an application in your pipeline.', 'Escaneo terminado. Nada en ese rango coincide con una postulación de tu tablero.'));
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
    setMsg(t(`${accepted.length} application${accepted.length > 1 ? 's' : ''} updated, each with an entry in its activity log.`, `${accepted.length} postulación${accepted.length > 1 ? 'es' : ''} actualizada${accepted.length > 1 ? 's' : ''}, cada una con su entrada en el historial.`));
    setBusy(false);
  };

  const emailEvents = store.event.filter((e) => e.kind === 'email').slice(0, 8);

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <SectionTitle>{t('Connection', 'Conexión')}</SectionTitle>
        {status === null ? (
          <div className="skeleton h-16 rounded-lg" />
        ) : status.configured ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="emerald">{t('connected', 'conectado')}</Badge>
            <span className="text-sm text-ink-700">{status.user} · {status.host}</span>
            <div className="ml-auto flex items-end gap-2">
              <Field label={t('Look back (days)', 'Mirar atrás (días)')} type="number" value={days} min={1} max={365}
                     onChange={(e) => setDays(Number(e.target.value))} className="w-32" />
              <Button variant="primary" disabled={busy} onClick={scan}>{busy ? t('Scanning…', 'Escaneando…') : t('Scan inbox', 'Escanear correo')}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <Badge tone="amber">{t('not configured', 'sin configurar')}</Badge>
            <p className="text-ink-700">
              {t('Scanning reads your mailbox over IMAP. Your password is never entered into this app and never stored in the database — put it in a .env file next to package.json, which only the API process on this machine reads:',
                 'El escaneo lee tu correo por IMAP. Tu contraseña nunca se carga en esta app ni se guarda en la base — ponéla en un archivo .env junto a package.json, que sólo lee el proceso de la API en esta máquina:')}
            </p>
            <pre className="overflow-x-auto rounded-lg border border-line bg-sunken p-3 text-xs text-ink-700">{`IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=you@gmail.com
IMAP_PASSWORD=your-app-password`}</pre>
            <p className="text-ink-500">
              {t('For Gmail use an app password (Google Account → Security → 2-Step Verification → App passwords), never your account password. Restart npm run dev afterwards.',
                 'Para Gmail usá una contraseña de aplicación (Cuenta de Google → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones), nunca la de tu cuenta. Después reiniciá npm run dev.')}
            </p>
          </div>
        )}
        {msg && <p className="mt-3 rounded-lg border border-line bg-sunken px-3 py-2 text-sm text-ink-700">{msg}</p>}
      </Card>

      <div>
        <SectionTitle right={
          proposals.length > 0
            ? <Button variant="primary" disabled={busy || !accepted.length} onClick={apply}>{t(`Apply ${accepted.length} change${accepted.length === 1 ? '' : 's'}`, `Aplicar ${accepted.length} cambio${accepted.length === 1 ? '' : 's'}`)}</Button>
            : undefined
        }>
          {t('Proposed status changes', 'Cambios de estado propuestos')}
        </SectionTitle>

        {proposals.length === 0 ? (
          <Empty>
            {scanned
              ? t('Nothing to propose. Statuses only move forward, so rows that are already current stay untouched.',
                  'Nada para proponer. Los estados sólo avanzan, así que las filas que ya están al día no se tocan.')
              : t('Nothing scanned yet. A scan reads subjects and senders, matches them to companies in your pipeline, and proposes moves — it never applies them on its own.',
                  'Todavía no escaneaste. El escaneo lee asuntos y remitentes, los cruza con las empresas de tu tablero, y propone movimientos — nunca los aplica solo.')}
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
                      <Badge tone={statusMeta(p.current).tone}>{t(statusMeta(p.current).label, statusMeta(p.current).es)}</Badge>
                      <span className="text-ink-400">→</span>
                      <Badge tone={statusMeta(p.proposed).tone}>{t(statusMeta(p.proposed).label, statusMeta(p.proposed).es)}</Badge>
                      {p.confidence === 'medium' && <Badge tone="amber">{t('check this one', 'revisá esta')}</Badge>}
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
          {t('Rules read English and Spanish. “Gracias por postularte” is treated as an acknowledgement, not a rejection — it only ever moves a row to Applied.',
             'Las reglas leen inglés y español. “Gracias por postularte” se toma como acuse de recibo, no como rechazo — sólo mueve la fila a Postulado.')}
        </p>
      </div>

      {emailEvents.length > 0 && (
        <div>
          <SectionTitle>{t('Applied from email', 'Aplicado desde el correo')}</SectionTitle>
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
