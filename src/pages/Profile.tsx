import { useState } from 'react';
import { Area, Badge, Button, Card, Empty, Field, Select, SectionTitle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { TRACKS, parseBullets, type Bullet, type Experience, type Profile, type Store, type Track } from '../lib/types.ts';

const KINDS: { id: Experience['kind']; label: string }[] = [
  { id: 'work', label: 'Experience' },
  { id: 'education', label: 'Education' },
  { id: 'extra', label: 'Leadership & extracurricular' },
];

export default function ProfilePage({ store, reload }: { store: Store; reload: () => Promise<void> }) {
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
                + Add
              </Button>
            }
          >
            {k.label}
          </SectionTitle>
          <div className="space-y-3">
            {store.experience.filter((e) => e.kind === k.id).map((e) => (
              <ExperienceCard key={e.id} exp={e} reload={reload} />
            ))}
            {store.experience.filter((e) => e.kind === k.id).length === 0 && (
              <Empty>Nothing here yet.</Empty>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function Identity({ profile, reload }: { profile: Profile; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState(profile);
  const set = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Identity</h2>
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={async () => { await api.saveProfile(draft as unknown as Record<string, string>); await reload(); }}
        >
          {dirty ? 'Save' : 'Saved'}
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Full name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        <Field label="Headline" value={draft.headline} onChange={(e) => set({ headline: e.target.value })}
               placeholder="Risk Reporting Intern, J.P. Morgan · ITBA 2026" />
        <Field label="Location" value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder="Buenos Aires, Argentina" />
        <Field label="Email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />
        <Field label="Phone" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
        <Field label="LinkedIn" value={draft.linkedin} onChange={(e) => set({ linkedin: e.target.value })} />
        <Area className="md:col-span-3" label="Profile paragraph (goes at the top of the CV and inside cover letters)" rows={3}
              value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
        <Area className="md:col-span-2" label="Skills line" rows={2} value={draft.skills}
              onChange={(e) => set({ skills: e.target.value })} placeholder="Excel (advanced), SQL, Python (pandas), Bloomberg, Tableau" />
        <Area label="Languages" rows={2} value={draft.languages} onChange={(e) => set({ languages: e.target.value })}
              placeholder="Spanish (native), English (C1)" />
      </div>
    </Card>
  );
}

function ExperienceCard({ exp, reload }: { exp: Experience; reload: () => Promise<void> }) {
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
        <button onClick={() => setExpanded((v) => !v)} className="mt-0.5 text-slate-500 hover:text-slate-200">
          {expanded ? '▾' : '▸'}
        </button>
        <div className="min-w-0 flex-1">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Organisation" value={draft.org} onChange={(e) => set({ org: e.target.value })} />
            <Field label="Title" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
            <Field label="From" value={draft.start_date} onChange={(e) => set({ start_date: e.target.value })} placeholder="Feb 2026" />
            <Field label="To" value={draft.end_date} onChange={(e) => set({ end_date: e.target.value })} placeholder="Present" />
          </div>

          {expanded && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Location" value={draft.location} onChange={(e) => set({ location: e.target.value })} />
                <Select label="Section" value={draft.kind} onChange={(e) => set({ kind: e.target.value as Experience['kind'] })}>
                  {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </Select>
                <Field label="Sort order" type="number" value={draft.sort_order}
                       onChange={(e) => set({ sort_order: Number(e.target.value) })} />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400">
                    Bullets — untagged ones appear on every CV; tagged ones only on that track’s version
                  </span>
                  <Button onClick={() => setBullets((bs) => [...bs, { text: '', tracks: [] }])}>+ Bullet</Button>
                </div>
                <div className="space-y-3">
                  {bullets.map((b, i) => (
                    <div key={i} className="rounded-lg border border-ink-800 p-3">
                      <Area rows={2} value={b.text} onChange={(e) => setBullet(i, { text: e.target.value })}
                            placeholder="Verb + what you did + the number. e.g. “Rebuilt the daily VaR exception report in SQL, cutting production time from 90 to 20 minutes.”" />
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {TRACKS.map((t) => (
                          <button key={t.id} onClick={() => toggleTrack(i, t.id)}
                                  className={`rounded border px-1.5 py-0.5 text-[11px] transition ${
                                    b.tracks.includes(t.id)
                                      ? 'border-accent/50 bg-accent/15 text-accent'
                                      : 'border-ink-700 text-slate-500 hover:text-slate-300'}`}>
                            {t.short}
                          </button>
                        ))}
                        <span className="ml-auto text-[11px] text-slate-600">
                          {b.tracks.length === 0 ? 'all tracks' : `${b.tracks.length} track${b.tracks.length > 1 ? 's' : ''}`}
                        </span>
                        <button onClick={() => setBullets((bs) => bs.filter((_, j) => j !== i))}
                                className="text-[11px] text-slate-600 hover:text-rose-300">remove</button>
                      </div>
                    </div>
                  ))}
                  {bullets.length === 0 && <p className="text-sm text-slate-500">No bullets yet.</p>}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button variant="primary" disabled={!dirty} onClick={save}>{dirty ? 'Save' : 'Saved'}</Button>
          {expanded && (
            <Button variant="danger" onClick={async () => {
              if (!confirm(`Delete “${exp.org}”?`)) return;
              await api.remove('experience', exp.id); await reload();
            }}>Delete</Button>
          )}
          {!expanded && bullets.length > 0 && <Badge>{bullets.length} bullets</Badge>}
        </div>
      </div>
    </Card>
  );
}
