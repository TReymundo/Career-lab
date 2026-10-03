import { useState } from 'react';
import { Button, Card } from './ui.tsx';
import KeyBox, { useAiStatus } from './KeyBox.tsx';
import { api, type FieldEdit, type FieldItem } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import { parseBullets, type Store, type Track } from '../lib/types.ts';

const firstTrack = (s: Store): Track => {
  try { return (JSON.parse(s.setting['tracks'] || '[]') as Track[])[0] ?? 'other'; } catch { return 'other'; }
};

/* ---------------------------------------------------------------- the one AI pass */

export default function Polish({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const lang = useUILang();
  const [status, setStatus] = useAiStatus();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [edits, setEdits] = useState<FieldEdit[]>([]);
  const [summary, setSummary] = useState('');
  const [ran, setRan] = useState(false);
  const track = firstTrack(store);

  /** Every addressable field, so the model returns edits that can actually be applied. */
  const fields = (): FieldItem[] => {
    const out: FieldItem[] = [
      { target: 'profile.headline', label: t('Headline', 'Título'), value: store.profile.headline },
      { target: 'profile.summary', label: t('Profile', 'Perfil'), value: store.profile.summary },
      { target: 'profile.skills', label: t('Skills', 'Habilidades'), value: store.profile.skills },
      { target: 'profile.languages', label: t('Languages', 'Idiomas'), value: store.profile.languages },
    ].filter((f) => f.value.trim());
    for (const e of store.experience) {
      if (e.org.trim()) out.push({ target: `exp.${e.id}.org`, label: t('Organisation', 'Organización'), value: e.org });
      if (e.title.trim()) out.push({ target: `exp.${e.id}.title`, label: t('Role', 'Rol'), value: e.title });
      parseBullets(e.bullets).forEach((b, i) => {
        if (b.text.trim()) out.push({ target: `exp.${e.id}.bullet.${i}`, label: `${e.org} — ${t('line', 'línea')} ${i + 1}`, value: b.text });
      });
    }
    return out;
  };

  const run = async () => {
    setBusy(true); setErr('');
    try {
      const [polish, para] = await Promise.all([
        fields().length ? api.aiPolish({ fields: fields(), track, lang }) : Promise.resolve({ edits: [] }),
        store.profile.summary.trim() ? Promise.resolve({ text: '' }) : api.aiSummary({
          headline: store.profile.headline,
          bullets: store.experience.flatMap((e) => parseBullets(e.bullets).map((b) => b.text)),
          track, lang,
        }),
      ]);
      setEdits(polish.edits);
      setSummary(para.text);
      setRan(true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const apply = async (edit: FieldEdit) => {
    const [scope, a, b, c] = edit.target.split('.');
    if (scope === 'profile') await api.saveProfile({ [a]: edit.to });
    else if (scope === 'exp') {
      const exp = store.experience.find((e) => e.id === Number(a));
      if (exp && b === 'bullet') {
        const bs = parseBullets(exp.bullets);
        if (bs[Number(c)]) { bs[Number(c)] = { ...bs[Number(c)], text: edit.to }; await api.update('experience', exp.id, { bullets: JSON.stringify(bs) }); }
      } else if (exp) await api.update('experience', exp.id, { [b]: edit.to });
    }
    setEdits((l) => l.filter((x) => x !== edit));
    await reload();
  };

  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-ink-900">✨ {t('Polish it with AI', 'Pulilo con IA')} <span className="font-normal text-ink-400">· {t('optional', 'opcional')}</span></p>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        {t('One pass: fixes typos and weak wording, and writes your profile paragraph. It never invents a fact or a number — you approve every change.',
           'Una pasada: corrige errores y frases flojas, y escribe tu párrafo de perfil. Nunca inventa un dato ni un número — aprobás cada cambio.')}
      </p>
      <div className="mt-3 space-y-3">
        {status?.configured ? (
          <Button variant="soft" className="w-full" disabled={busy} onClick={run}>
            {busy ? t('Reading your CV…', 'Leyendo tu CV…') : ran ? t('Run it again', 'Correrlo de nuevo') : t('Polish my CV', 'Pulir mi CV')}
          </Button>
        ) : (
          <KeyBox status={status} onChange={setStatus} reason={t('Needs a free Google AI key.', 'Necesita una clave gratis de Google AI.')} />
        )}
        {err && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{err}</p>}

        {summary && (
          <div className="animate-rise space-y-2 rounded-xl border border-brand-200 bg-brand-50/50 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-brand-700">{t('Profile paragraph', 'Párrafo de perfil')}</p>
            <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)}
                      className="w-full resize-y rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand-400" />
            <div className="flex gap-2">
              <Button variant="primary" onClick={async () => { await api.saveProfile({ summary }); setSummary(''); await reload(); }}>{t('Use it', 'Usarlo')}</Button>
              <Button variant="ghost" onClick={() => setSummary('')}>{t('No thanks', 'No, gracias')}</Button>
            </div>
          </div>
        )}

        {edits.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-ink-500">{t(`${edits.length} suggested changes`, `${edits.length} cambios sugeridos`)}</p>
              <Button variant="soft" onClick={async () => { for (const e of [...edits]) await apply(e); }}>{t('Apply all', 'Aplicar todos')}</Button>
            </div>
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {edits.map((e, i) => (
                <div key={i} className="animate-rise rounded-lg border border-line bg-surface px-3 py-2 text-xs">
                  <p className="uppercase tracking-wider text-ink-400">{e.label}</p>
                  <p className="mt-1 text-ink-400 line-through">{e.from}</p>
                  <p className="text-sm text-ink-900">{e.to}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="flex-1 text-ink-500">{e.why}</span>
                    <Button variant="soft" onClick={() => apply(e)}>{t('Apply', 'Aplicar')}</Button>
                    <Button variant="ghost" onClick={() => setEdits((l) => l.filter((x) => x !== e))}>✕</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {ran && !busy && !edits.length && !summary && !err && (
          <p className="animate-fade text-xs text-brand-700">✓ {t('Nothing left to change.', 'No queda nada para cambiar.')}</p>
        )}
      </div>
    </Card>
  );
}
