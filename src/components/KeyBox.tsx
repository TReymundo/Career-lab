import { useEffect, useState } from 'react';
import { Badge, Button, Field } from './ui.tsx';
import { api, type AiStatus } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';

export function useAiStatus() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => { void api.aiStatus().then(setStatus).catch(() => setStatus(null)); }, []);
  return [status, setStatus] as const;
}

/** A compact key box, shown exactly where a key would help rather than as its own step. */
export default function KeyBox({ status, onChange, reason }: { status: AiStatus | null; onChange: (s: AiStatus) => void; reason: string }) {
  const t = useT();
  const [key, setKey] = useState('');
  const [open, setOpen] = useState(false);

  if (status?.configured) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-500">
        <Badge tone="emerald">{t('Google AI connected', 'Google AI conectado')}</Badge>
        <span className="text-xs">{t('key ending', 'clave terminada en')} {status.hint}</span>
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface/70 px-4 py-3 text-sm">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left text-ink-700">
        <span className="text-brand-600">✦</span>
        <span className="flex-1">{reason}</span>
        <span className="text-xs text-brand-700">{open ? t('Hide', 'Ocultar') : t('Add a free key', 'Agregar clave gratis')}</span>
      </button>
      {open && (
        <div className="animate-fade mt-3 space-y-2">
          <p className="text-xs text-ink-500">
            {t('Create one at', 'Creala en')}{' '}
            <a className="text-brand-700 underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>
            {t(' — free, takes a minute. It stays on this computer.', ' — es gratis y lleva un minuto. Queda en esta computadora.')}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
                   placeholder={t('Paste your key', 'Pegá tu clave')} className="min-w-56 flex-1" />
            <Button variant="primary" disabled={!key.trim()} onClick={async () => { onChange(await api.aiSetKey(key.trim())); setKey(''); }}>
              {t('Save', 'Guardar')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
