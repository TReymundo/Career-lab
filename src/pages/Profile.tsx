import { useState } from 'react';
import { Area, Badge, Button, Card, Empty, Field, Select, SectionTitle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import { TRACKS, parseBullets, type Bullet, type Experience, type Profile, type Store, type Track } from '../lib/types.ts';

type T = (en: string, es: string) => string;

const KINDS: { id: Experience['kind']; label: (t: T) => string }[] = [
  { id: 'work', label: (t) => t('Experience', 'Experiencia') },
  { id: 'education', label: (t) => t('Education', 'Formación') },
  { id: 'extra', label: (t) => t('Activities & leadership', 'Actividades y liderazgo') },
];

export default function ProfilePage({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  return (
    <div className="space-y-8">
      <Identity profile={store.profile} reload={reload} />
      {KINDS.map((k) => (
        <section key={k.id}>
          <SectionTitle
            right={
              <Button
                onClick={async () => {
                  await api.create<Experience>('experience', {
                    kind: k.id,
                    org: 'New entry',
                    sort_order: store.experience.length,
                  });
                  await reload();
                }}
              >
                {t('+ Add', '+ Agregar')}
              </Button>
            }
          >
            {k.label(t)}
          </SectionTitle>
          <div className="space-y-3">
            {store.experience.filter((e) => e.kind === k.id).map((e) => (
              <ExperienceCard key={e.id} exp={e} reload={reload} />
            ))}
            {store.experience.filter((e) => e.kind === k.id).length === 0 && (
              <Empty>{t('Nothing here yet.', 'Todavía no hay nada acá.')}</Empty>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function Identity({ profile, reload }: { profile: Profile; reload: () => Promise<void> }) {
  const t = useT();
  const [draft, setDraft] = useState(profile);
  const set = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-700">{t('Identity', 'Identidad')}</h2>
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={async () => { await api.saveProfile(draft as unknown as Record<string, string>); await reload(); }}
        >
          {dirty ? t('Save', 'Guardar') : t('Saved', 'Guardado')}
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={t('Full name', 'Nombre completo')} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        <Field label={t('Headline', 'Encabezado')} value={draft.headline} onChange={(e) => set({ headline: e.target.value })}
               placeholder="Final-year business student · graduating 2026" />
        <Field label={t('Location', 'Ubicación')} value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder="Buenos Aires, Argentina" />
        <Field label={t('Email', 'Email')} value={draft.email} onChange={(e) => set({ email: e.target.value })} />
        <Field label={t('Phone', 'Teléfono')} value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
        <Field label={t('LinkedIn', 'LinkedIn')} value={draft.linkedin} onChange={(e) => set({ linkedin: e.target.value })} />
        <Area className="md:col-span-3" label={t('Profile paragraph (goes at the top of the CV and inside cover letters)', 'Párrafo de perfil (va arriba del CV y dentro de las cartas)')} rows={3}
              value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
        <Area className="md:col-span-2" label={t('Skills line', 'Habilidades')} rows={2} value={draft.skills}
              onChange={(e) => set({ skills: e.target.value })} placeholder="Excel, SQL, Python, Canva — whatever you actually use" />
        <Area label={t('Languages', 'Idiomas')} rows={2} value={draft.languages} onChange={(e) => set({ languages: e.target.value })}
              placeholder="Spanish (native), English (C1)" />
      </div>

      <div className="mt-5 rounded-lg border border-line bg-sunken p-4">
        <p className="mb-3 text-[11px] uppercase tracking-wider text-ink-500">
          {t('Versión en español — used whenever you generate a Spanish CV. Anything left blank falls back to the English text.',
             'Versión en español — se usa al generar un CV en español. Lo que dejes vacío toma el texto en inglés.')}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t('Headline (ES)', 'Titular')} value={draft.headline_es} onChange={(e) => set({ headline_es: e.target.value })}
                 placeholder="Estudiante de último año · me recibo en 2026" />
          <Area className="md:col-span-2" label={t('Profile (ES)', 'Perfil')} rows={3} value={draft.summary_es}
                onChange={(e) => set({ summary_es: e.target.value })} />
          <Area className="md:col-span-2" label={t('Skills (ES)', 'Competencias')} rows={2} value={draft.skills_es}
                onChange={(e) => set({ skills_es: e.target.value })} placeholder="Excel, SQL, Python — lo que uses de verdad" />
          <Area label={t('Languages (ES)', 'Idiomas')} rows={2} value={draft.languages_es} onChange={(e) => set({ languages_es: e.target.value })}
                placeholder="Español (nativo), Inglés (C1)" />
        </div>
      </div>
    </Card>
  );
}

function ExperienceCard({ exp, reload }: { exp: Experience; reload: () => Promise<void> }) {
  const t = useT();
  const [draft, setDraft] = useState(exp);
  const [bullets, setBullets] = useState<Bullet[]>(parseBullets(exp.bullets));
  const [expanded, setExpanded] = useState(false);

  const dirty = JSON.stringify({ ...draft, bullets: JSON.stringify(bullets) }) !== JSON.stringify(exp);
  const set = (patch: Partial<Experience>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    await api.update('experience', exp.id, { ...draft, bullets: JSON.stringify(bullets) });
    await reload();
  };

  const setBullet = (i: number, patch: Partial<Bullet>) =>
    setBullets((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const toggleTrack = (i: number, t: Track) =>
    setBullet(i, {
      tracks: bullets[i].tracks.includes(t)
        ? bullets[i].tracks.filter((x) => x !== t)
        : [...bullets[i].tracks, t],
    });

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <button onClick={() => setExpanded((v) => !v)} className="mt-0.5 text-ink-500 hover:text-ink-900">
          {expanded ? '▾' : '▸'}
        </button>
        <div className="min-w-0 flex-1">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label={t('Organisation', 'Organización')} value={draft.org} onChange={(e) => set({ org: e.target.value })} />
            <Field label={t('Title', 'Puesto')} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
            <Field label={t('From', 'Desde')} value={draft.start_date} onChange={(e) => set({ start_date: e.target.value })} placeholder="Feb 2026" />
            <Field label={t('To', 'Hasta')} value={draft.end_date} onChange={(e) => set({ end_date: e.target.value })} placeholder="Present" />
          </div>

          {expanded && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label={t('Location', 'Ubicación')} value={draft.location} onChange={(e) => set({ location: e.target.value })} />
                <Select label={t('Section', 'Sección')} value={draft.kind} onChange={(e) => set({ kind: e.target.value as Experience['kind'] })}>
                  {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label(t)}</option>)}
                </Select>
                <Field label={t('Sort order', 'Orden')} type="number" value={draft.sort_order}
                       onChange={(e) => set({ sort_order: Number(e.target.value) })} />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-ink-500">
                    {t('Bullets — untagged ones appear on every CV; tagged ones only on that track’s version',
                       'Líneas — las sin etiqueta van en todos los CVs; las etiquetadas sólo en esa versión')}
                  </span>
                  <Button onClick={() => setBullets((bs) => [...bs, { text: '', tracks: [] }])}>{t('+ Line', '+ Línea')}</Button>
                </div>
                <div className="space-y-3">
                  {bullets.map((b, i) => (
                    <div key={i} className="rounded-lg border border-line p-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        <Area rows={2} value={b.text} onChange={(e) => setBullet(i, { text: e.target.value })}
                              placeholder="EN — Verb + what you did + the number. e.g. “Rebuilt the daily VaR exception report in SQL, cutting production time from 90 to 20 minutes.”" />
                        <Area rows={2} value={b.es ?? ''} onChange={(e) => setBullet(i, { es: e.target.value })}
                              className={b.es?.trim() ? '' : 'opacity-70'}
                              placeholder="ES — la misma línea en español. Si lo dejás vacío, el CV en español usa el texto en inglés." />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {TRACKS.map((t) => (
                          <button key={t.id} onClick={() => toggleTrack(i, t.id)}
                                  className={`rounded border px-1.5 py-0.5 text-[11px] transition ${
                                    b.tracks.includes(t.id)
                                      ? 'border-brand-400 bg-brand-100 text-brand-600'
                                      : 'border-line text-ink-500 hover:text-ink-700'}`}>
                            {t.short}
                          </button>
                        ))}
                        <span className="ml-auto text-[11px] text-ink-400">
                          {b.tracks.length === 0 ? t('all tracks', 'todos') : `${b.tracks.length}`}
                        </span>
                        <button onClick={() => setBullets((bs) => bs.filter((_, j) => j !== i))}
                                className="text-[11px] text-ink-400 hover:text-rose-600">{t('remove', 'quitar')}</button>
                      </div>
                    </div>
                  ))}
                  {bullets.length === 0 && <p className="text-sm text-ink-500">{t('No lines yet.', 'Todavía no hay líneas.')}</p>}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button variant="primary" disabled={!dirty} onClick={save}>{dirty ? t('Save', 'Guardar') : t('Saved', 'Guardado')}</Button>
          {expanded && (
            <Button variant="danger" onClick={async () => {
              if (!confirm(`Delete “${exp.org}”?`)) return;
              await api.remove('experience', exp.id); await reload();
            }}>{t('Delete', 'Eliminar')}</Button>
          )}
          {!expanded && bullets.length > 0 && <Badge>{bullets.length} {t('lines', 'líneas')}</Badge>}
        </div>
      </div>
    </Card>
  );
}
