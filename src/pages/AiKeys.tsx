import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field } from '../components/ui.tsx';
import { api, type AiHealth } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';

/**
 * Several free AI providers, so nothing in the app stops because one of them is busy.
 *
 * Every request walks the list — each Google model first (each has its own free allowance),
 * then the others — and a provider at its limit rests for a minute while the next answers.
 */

const KINDS = [
  { kind: 'google', name: 'Google Gemini', badge: 'Main · reads PDFs', url: 'https://aistudio.google.com/apikey',
    how: { en: 'Create a key at aistudio.google.com/apikey. A second Google account gives you a second, separate free allowance.', es: 'Creá una clave en aistudio.google.com/apikey. Una segunda cuenta de Google te da una segunda cuota gratis, aparte.' } },
  { kind: 'groq', name: 'Groq', badge: '~1,000 / day', url: 'https://console.groq.com/keys',
    how: { en: 'console.groq.com/keys. If it says only owners can create keys, create your own team from the top-left menu first.', es: 'console.groq.com/keys. Si dice que sólo los dueños pueden crear claves, primero creá tu propio equipo desde el menú de arriba a la izquierda.' } },
  { kind: 'github', name: 'GitHub Models', badge: 'free with GitHub', url: 'https://github.com/settings/personal-access-tokens/new',
    how: { en: 'Create a fine-grained token at github.com → Settings → Developer settings, with the “Models: read” permission.', es: 'Creá un token fine-grained en github.com → Settings → Developer settings, con el permiso “Models: read”.' } },
  { kind: 'mistral', name: 'Mistral', badge: 'free plan', url: 'https://console.mistral.ai/api-keys',
    how: { en: 'console.mistral.ai → API keys, on the free plan (no card).', es: 'console.mistral.ai → API keys, con el plan gratis (sin tarjeta).' } },
  { kind: 'openrouter', name: 'OpenRouter', badge: 'free models', url: 'https://openrouter.ai/keys',
    how: { en: 'openrouter.ai/keys. Only its free models are used.', es: 'openrouter.ai/keys. Sólo se usan sus modelos gratis.' } },
] as const;

/** "04:00" — when a resting model comes back, in this computer's time. */
const clock = (iso: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

export default function AiKeys() {
  const t = useT();
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [open, setOpen] = useState<string>('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Record<string, string>>({});

  const load = async () => setHealth(await api.aiHealth());
  useEffect(() => { void load(); const id = setInterval(() => void load(), 5000); return () => clearInterval(id); }, []);

  const routes = health?.routes ?? [];
  const ready = routes.filter((r) => r.ready).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-5 p-6">
          <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-forest-900">
            <span className="font-display text-2xl font-semibold text-lime-300">{ready}</span>
            {ready > 0 && <span className="step-glow absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-lime-400" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-xl font-semibold text-forest-900">
              {t(`${ready} of ${routes.length} AI models ready`, `${ready} de ${routes.length} modelos de IA listos`)}
            </p>
            <p className="text-sm text-ink-500">
              {routes.length <= 5
                ? t('Add one more free provider below and the app basically stops running out.', 'Agregá un proveedor gratis más acá abajo y la app prácticamente deja de quedarse sin cuota.')
                : t('Plenty of fallbacks. Requests rotate on their own.', 'Respaldo de sobra. Los pedidos rotan solos.')}
            </p>
          </div>
        </div>
        {routes.length > 0 && (
          <div className="stagger grid gap-1.5 border-t border-line bg-sunken/40 p-4 sm:grid-cols-2">
            {routes.map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2 text-xs">
                <span className={`h-2 w-2 shrink-0 rounded-full ${r.ready ? 'bg-brand-500' : r.resting ? 'bg-amber-400' : 'bg-rose-400'}`} />
                <span className="min-w-0 flex-1 truncate text-ink-700" title={r.lastError}>{r.label}</span>
                <span className="shrink-0 tabular-nums text-ink-400">
                  {r.resting
                    ? r.resting > 3600 || /daily/.test(r.lastError)
                      ? t(`daily limit · back at ${clock(r.until)}`, `límite diario · vuelve a las ${clock(r.until)}`)
                      : t(`resting ${r.resting > 90 ? `${Math.ceil(r.resting / 60)} min` : `${r.resting}s`}`, `descansa ${r.resting > 90 ? `${Math.ceil(r.resting / 60)} min` : `${r.resting}s`}`)
                    : r.lastError ? t('not answering — retrying', 'no responde — reintentando')
                    : r.ok ? `✓ ${r.ok}` : t('ready', 'listo')}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="space-y-3">
        {KINDS.map((k) => {
          const mine = health?.providers.filter((p) => p.kind === k.kind) ?? [];
          const isOpen = open === k.kind;
          return (
            <Card key={k.kind} className={`overflow-hidden transition ${isOpen ? 'ring-2 ring-brand-200' : ''}`}>
              <button onClick={() => { setOpen(isOpen ? '' : k.kind); setKey(''); }} className="flex w-full items-center gap-4 px-5 py-4 text-left">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl font-display text-lg font-semibold ${mine.length ? 'bg-forest-900 text-lime-300' : 'bg-sunken text-ink-400'}`}>
                  {k.name[0]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-900">{k.name}</span>
                    <Badge tone="slate">{k.badge}</Badge>
                    {mine.length > 0 && <Badge tone="emerald">{mine.length} {t('connected', 'conectada(s)')}</Badge>}
                  </span>
                </span>
                <span className="text-sm font-medium text-brand-700">{isOpen ? t('Close', 'Cerrar') : mine.length ? t('Manage', 'Gestionar') : t('+ Add', '+ Agregar')}</span>
              </button>
              {isOpen && (
                <div className="animate-fade space-y-3 border-t border-line px-5 py-4">
                  {mine.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-sunken/60 px-3 py-2 text-sm">
                      <span className="font-mono text-ink-700">{p.hint}</span>
                      {result[p.id] && <span className="text-xs text-ink-500">{result[p.id]}</span>}
                      <Button className="ml-auto" disabled={busy === p.id} onClick={async () => {
                        setBusy(p.id);
                        const r = await api.testAiProvider(p.id);
                        setResult((x) => ({ ...x, [p.id]: r.ok ? `✓ ${r.model}` : `✕ ${r.error}` }));
                        setBusy(''); await load();
                      }}>{busy === p.id ? t('Testing…', 'Probando…') : t('Test', 'Probar')}</Button>
                      <Button variant="ghost" onClick={async () => { await api.removeAiProvider(p.id); await load(); }}>{t('Remove', 'Quitar')}</Button>
                    </div>
                  ))}
                  <p className="text-sm text-ink-600">
                    {k.how[t('en', 'es') as 'en' | 'es']}{' '}
                    <a href={k.url} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline">{t('Open', 'Abrir')} ↗</a>
                  </p>
                  <div className="flex gap-2">
                    <Field type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('Paste the key', 'Pegá la clave')} className="flex-1" />
                    <Button variant="primary" disabled={!key.trim() || busy === 'add'} onClick={async () => {
                      setBusy('add');
                      const r = await api.addAiProvider(k.kind, key.trim());
                      setResult((x) => ({ ...x, [k.kind]: r.ok ? t(`✓ Works — answered with ${r.model}`, `✓ Funciona — respondió ${r.model}`) : `✕ ${r.error}` }));
                      setKey(''); setBusy(''); await load();
                    }}>{busy === 'add' ? t('Checking…', 'Probando…') : t('Add & test', 'Agregar y probar')}</Button>
                  </div>
                  {result[k.kind] && <p className={`animate-fade text-sm ${result[k.kind].startsWith('✓') ? 'text-brand-700' : 'text-amber-700'}`}>{result[k.kind]}</p>}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <p className="text-center text-xs text-ink-400">
        {t('Keys are stored on this computer only and never shown again — just their last four characters. Answers are cached for two weeks, so repeating something costs nothing.',
           'Las claves se guardan sólo en esta computadora y nunca se muestran de nuevo — sólo sus últimos cuatro caracteres. Las respuestas quedan guardadas dos semanas, así repetir algo no gasta nada.')}
      </p>
    </div>
  );
}
