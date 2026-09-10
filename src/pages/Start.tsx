import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, Badge, Button, Card, Field, Select } from '../components/ui.tsx';
import { api, type BulletSuggestion } from '../lib/api.ts';
import { buildCV } from '../lib/templates.ts';
import { TRACKS, parseBullets, type Experience, type ParsedCV, type Store, type Track } from '../lib/types.ts';

/**
 * One path, top to bottom. Each step does its own work inline and ticks itself off when you
 * save, so there is never a moment where the next move is a guess. Nothing here assumes a
 * particular university, country, or that you have any work experience at all.
 */

interface Ctx {
  store: Store;
  reload: () => Promise<void>;
  done: (id: string) => void;
  next: () => void;
}

interface Step {
  id: string;
  title: string;
  help: string;
  optional?: boolean;
  auto?: (s: Store) => boolean;      // completes itself once the data exists
  render: (ctx: Ctx) => React.ReactNode;
}

interface Phase { id: string; title: string; blurb: string; steps: Step[] }

const hasDigit = (s: string) => /\d/.test(s);
const allBullets = (s: Store) => s.experience.flatMap((e) => parseBullets(e.bullets));

const PHASES: Phase[] = [
  {
    id: 'you',
    title: 'Who you are',
    blurb: 'Two minutes. Everything else builds on this.',
    steps: [
      {
        id: 'basics',
        title: 'Your name and contact details',
        help: 'These go at the top of every document. A CV without a phone number gets filtered out before a human sees it.',
        auto: (s) => Boolean(s.profile.name.trim() && s.profile.email.trim()),
        render: (ctx) => <Basics {...ctx} />,
      },
      {
        id: 'target',
        title: 'What kind of work are you going for?',
        help: 'Pick anything that fits — you can choose more than one, and change it later. This decides how your CV gets framed.',
        auto: (s) => Boolean(s.setting['tracks']),
        render: (ctx) => <Target {...ctx} />,
      },
    ],
  },
  {
    id: 'cv',
    title: 'Build your CV',
    blurb: 'Import one you already have, or make one from nothing. Both work.',
    steps: [
      {
        id: 'source',
        title: 'Do you already have a CV?',
        help: 'If you do, upload it and it fills everything in. If you do not, that is fine — say so and the next steps build one.',
        auto: (s) => s.experience.length > 0 || s.setting['step:source'] === 'done',
        render: (ctx) => <CVSource {...ctx} />,
      },
      {
        id: 'education',
        title: 'Your education',
        help: 'University, tertiary, high school, a bootcamp, or still studying — all of it counts and all of it belongs here.',
        auto: (s) => s.experience.some((e) => e.kind === 'education' && e.org.trim()),
        render: (ctx) => <EducationStep {...ctx} />,
      },
      {
        id: 'experience',
        title: 'Your experience',
        help: 'Jobs and internships if you have them. If you have none at all, this step shows you what else counts and helps you write it.',
        auto: (s) => s.experience.some((e) => e.kind !== 'education' && parseBullets(e.bullets).length > 0),
        render: (ctx) => <ExperienceStep {...ctx} />,
      },
      {
        id: 'numbers',
        title: 'Put a number in each line',
        help: 'The single biggest improvement you can make. "Helped with events" is invisible; "ran 4 events for 300 people" is a fact.',
        auto: (s) => {
          const bs = allBullets(s);
          return bs.length >= 2 && bs.filter((b) => hasDigit(b.text)).length / bs.length >= 0.6;
        },
        render: (ctx) => <NumbersStep {...ctx} />,
      },
    ],
  },
  {
    id: 'ai',
    title: 'Sharpen it with AI',
    blurb: 'Optional, and it needs your own Google API key. Skip the whole phase if you would rather not.',
    steps: [
      {
        id: 'key',
        title: 'Connect your Google AI key',
        help: 'Free to create. Paste it here and the next two steps light up. Nothing is sent anywhere until you press a button.',
        optional: true,
        render: (ctx) => <AIKey {...ctx} />,
      },
      {
        id: 'rewrite',
        title: 'Rewrite your bullets',
        help: 'The AI sharpens what you wrote. It is not allowed to invent numbers — where one is missing it asks you for it instead.',
        optional: true,
        render: (ctx) => <AIBullets {...ctx} />,
      },
      {
        id: 'profile-para',
        title: 'Write your profile paragraph and get a review',
        help: 'A short paragraph for the top of the CV, then an honest review of the whole thing.',
        optional: true,
        render: (ctx) => <AIReview {...ctx} />,
      },
    ],
  },
  {
    id: 'jobs',
    title: 'Find jobs',
    blurb: 'Get openings into the app so you can search and rank them.',
    steps: [
      {
        id: 'linkedin',
        title: 'Open LinkedIn and collect some jobs',
        help: 'Search, save what looks right, then bring them in. Two buttons below do both halves.',
        auto: (s) => s.setting['step:linkedin'] === 'done',
        render: (ctx) => <JobsStep {...ctx} />,
      },
    ],
  },
  {
    id: 'apply',
    title: 'Apply',
    blurb: 'Turn a job into a tailored set of documents you can actually send.',
    steps: [
      {
        id: 'generate',
        title: 'Generate documents for a job',
        help: 'Tick a job, press generate. You get a CV, a cover letter, a message to send someone, and interview prep for that posting.',
        auto: (s) => s.document.length > 0,
        render: () => (
          <Steps
            to="/jobs"
            cta="Go to Jobs"
            points={[
              'Tick a job in the list, choose your language, press Generate CV.',
              'In the generator, press "Generate full pack" to write everything at once.',
              'Then Download DOCX for application forms, or PDF to email.',
            ]}
          />
        ),
      },
      {
        id: 'answers',
        title: 'Write the answers forms keep asking for',
        help: 'Why this firm, a leadership story, a failure story. Write each once and reuse it for months.',
        optional: true,
        auto: (s) => s.answer.filter((a) => !a.company && a.body.trim()).length >= 3,
        render: () => (
          <Steps to="/answers" cta="Open Answer bank"
                 points={['Start with the first three. Each has a word limit and a note on what a good answer does.']} />
        ),
      },
    ],
  },
  {
    id: 'track',
    title: 'Keep track',
    blurb: 'So nothing slips while you are busy.',
    steps: [
      {
        id: 'pipeline',
        title: 'Move things across the board',
        help: 'Every job you generate for lands on the board. Drag it as it moves; the dates and the log take care of themselves.',
        auto: (s) => s.application.some((a) => a.status !== 'saved'),
        render: () => (
          <Steps to="/pipeline" cta="Open Pipeline"
                 points={['Saved → Tailored → Applied → Interviewing → Offer or Rejected.', 'Give anything live a next action with a date.']} />
        ),
      },
      {
        id: 'backup',
        title: 'Back it up',
        help: 'It all lives in one file on this laptop. Download a copy and put it somewhere else.',
        auto: (s) => s.setting['step:backup'] === 'done',
        render: (ctx) => <BackupStep {...ctx} />,
      },
    ],
  },
];

const ALL_STEPS = PHASES.flatMap((p) => p.steps.map((s) => ({ ...s, phase: p.id })));

export default function Start({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const isDone = (s: Step) => store.setting[`step:${s.id}`] === 'done' || Boolean(s.auto?.(store));
  const state = useMemo(() => ALL_STEPS.map((s) => ({ step: s, done: isDone(s) })), [store]);

  const firstOpen = state.find((s) => !s.done)?.step.id ?? null;
  const active = openId ?? firstOpen;
  const doneCount = state.filter((s) => s.done).length;

  const done = (id: string) => { void api.setSetting(`step:${id}`, 'done').then(reload); };
  const next = () => {
    const i = ALL_STEPS.findIndex((s) => s.id === active);
    setOpenId(ALL_STEPS[i + 1]?.id ?? null);
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-3xl font-semibold tabular-nums text-ink-900">
              {doneCount}<span className="text-ink-400">/{ALL_STEPS.length}</span>
            </p>
            <p className="text-sm text-ink-500">Work down the list. Each step saves, ticks itself off, and opens the next one.</p>
          </div>
          {doneCount === ALL_STEPS.length && <Badge tone="emerald">All done — the rest is applying</Badge>}
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${(doneCount / ALL_STEPS.length) * 100}%` }} />
        </div>
      </Card>

      {PHASES.map((phase, pi) => {
        const steps = state.filter((s) => phase.steps.some((p) => p.id === s.step.id));
        const phaseDone = steps.every((s) => s.done);
        return (
          <section key={phase.id}>
            <div className="mb-2 flex items-baseline gap-3">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                phaseDone ? 'bg-brand-500 text-white' : 'bg-sunken text-ink-500'}`}>
                {phaseDone ? '✓' : pi + 1}
              </span>
              <h2 className={`text-sm font-semibold uppercase tracking-wider ${phaseDone ? 'text-ink-400' : 'text-ink-900'}`}>{phase.title}</h2>
              <p className="text-xs text-ink-500">{phase.blurb}</p>
            </div>

            <div className="ml-3 space-y-2 border-l border-line pl-5">
              {steps.map(({ step, done: stepDone }) => {
                const isOpen = active === step.id;
                return (
                  <Card key={step.id} className={`overflow-hidden transition ${isOpen ? 'border-brand-300 shadow-[0_8px_24px_-18px_rgb(16_35_26/.5)]' : ''}`}>
                    <button onClick={() => setOpenId(isOpen ? '' : step.id)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-brand-50">
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] transition ${
                        stepDone ? 'bg-brand-500 text-white' : 'border border-line-strong bg-surface text-ink-400'}`}>
                        {stepDone ? '✓' : ''}
                      </span>
                      <span className={`min-w-0 flex-1 text-sm font-medium transition ${
                        stepDone ? 'text-ink-400 line-through decoration-brand-400' : 'text-ink-900'}`}>
                        {step.title}
                      </span>
                      {step.optional && <Badge tone="slate">optional</Badge>}
                      <span className="text-ink-400">{isOpen ? '▾' : '▸'}</span>
                    </button>

                    {isOpen && (
                      <div className="animate-fade space-y-4 border-t border-line px-4 py-4">
                        <p className="text-sm leading-relaxed text-ink-700">{step.help}</p>
                        {step.render({ store, reload, done, next })}
                        {!stepDone && (
                          <button onClick={() => { done(step.id); next(); }} className="text-xs text-ink-400 underline hover:text-ink-700">
                            Skip this step
                          </button>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Every step's save button behaves the same: write, tick, move on. */
function SaveBar({ label = 'Save and continue', disabled, onSave, extra }: {
  label?: string; disabled?: boolean; onSave: () => Promise<void> | void; extra?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button variant="primary" disabled={disabled || busy} onClick={async () => { setBusy(true); await onSave(); setBusy(false); }}>
        {busy ? 'Saving…' : label}
      </Button>
      {extra}
    </div>
  );
}

function Steps({ points, to, cta }: { points: string[]; to?: string; cta?: string }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5 text-sm text-ink-700">
        {points.map((p, i) => <li key={i} className="flex gap-2"><span className="text-brand-500">→</span><span>{p}</span></li>)}
      </ul>
      {to && <Link to={to}><Button variant="primary">{cta}</Button></Link>}
    </div>
  );
}

function Basics({ store, reload, done, next }: Ctx) {
  const [d, setD] = useState(store.profile);
  const set = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Full name" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" />
        <Field label="Email" value={d.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@email.com" />
        <Field label="Phone" value={d.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+54 …" />
        <Field label="City, country" value={d.location} onChange={(e) => set({ location: e.target.value })} placeholder="City, Country" />
        <Field label="LinkedIn (optional)" value={d.linkedin} onChange={(e) => set({ linkedin: e.target.value })} placeholder="linkedin.com/in/…" />
        <Field label="One line about you" value={d.headline} onChange={(e) => set({ headline: e.target.value })}
               placeholder="Final-year business student" />
      </div>
      <SaveBar
        disabled={!d.name.trim() || !d.email.trim()}
        onSave={async () => {
          await api.saveProfile(d as unknown as Record<string, string>);
          await reload();
          done('basics');
          next();
        }}
      />
    </div>
  );
}

function Target({ store, reload, done, next }: Ctx) {
  const [picked, setPicked] = useState<Track[]>(() => {
    try { return JSON.parse(store.setting['tracks'] || '[]'); } catch { return []; }
  });
  const toggle = (t: Track) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TRACKS.map((t) => (
          <button key={t.id} onClick={() => toggle(t.id)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    picked.includes(t.id) ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-700 hover:bg-sunken'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <SaveBar disabled={!picked.length} onSave={async () => {
        await api.setSetting('tracks', JSON.stringify(picked));
        await reload();
        done('target');
        next();
      }} />
    </div>
  );
}

function CVSource({ reload, done, next }: Ctx) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedCV | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (payload: { text?: string; base64?: string; filename?: string }) => {
    setBusy(true); setMsg('');
    try {
      const res = await api.parseCV(payload);
      setParsed(res.parsed);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    await run({ base64: btoa(bin), filename: file.name });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => fileRef.current?.click()}>Upload my CV</Button>
        <Button onClick={() => { done('source'); next(); }}>I don’t have one — build it with me</Button>
      </div>
      <input ref={fileRef} type="file" accept=".docx,.txt,.md" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

      <p className="text-xs text-ink-500">
        Word (.docx), text and Markdown are read directly. For a PDF: open it, select all, copy, and paste below.
      </p>

      <details className="text-sm">
        <summary className="cursor-pointer text-brand-700">Paste the text instead</summary>
        <div className="mt-2 space-y-2">
          <Area rows={6} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" placeholder="Paste your whole CV here." />
          <Button disabled={busy || !text.trim()} onClick={() => run({ text })}>{busy ? 'Reading…' : 'Read it'}</Button>
        </div>
      </details>

      {msg && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{msg}</p>}

      {parsed && (
        <Card className="space-y-3 p-4">
          <p className="text-sm font-medium text-ink-900">Found this — check it before adding:</p>
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            {(['name', 'email', 'phone', 'linkedin'] as const).map((k) => (
              <div key={k} className="flex gap-2">
                <span className="w-16 shrink-0 text-xs uppercase tracking-wider text-ink-400">{k}</span>
                <span className={parsed[k] ? 'text-ink-900' : 'text-ink-400'}>{parsed[k] || '—'}</span>
              </div>
            ))}
          </div>
          {parsed.entries.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {parsed.entries.map((e, i) => (
                <li key={i} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5">
                  <Badge tone={e.kind === 'work' ? 'sky' : e.kind === 'education' ? 'violet' : 'amber'}>{e.kind}</Badge>
                  <span className="font-medium text-ink-900">{e.org || '—'}</span>
                  <span className="truncate text-ink-500">{e.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-ink-400">{e.bullets.length} lines</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-700">
              No entries recognised. It looks for headings like Experience / Education / Experiencia / Formación.
              You can skip this and type them in the next two steps instead.
            </p>
          )}
          <SaveBar label="Add these to my CV" onSave={async () => {
            await api.applyCV(parsed, false);
            await reload();
            setParsed(null);
            done('source');
            next();
          }} />
        </Card>
      )}
    </div>
  );
}

const LEVELS = [
  { id: 'university', label: 'University / college', org: '', title: 'Degree in …' },
  { id: 'tertiary', label: 'Tertiary / technical', org: '', title: 'Technical qualification in …' },
  { id: 'school', label: 'High school', org: '', title: 'Secondary school' },
  { id: 'bootcamp', label: 'Bootcamp / certificate', org: '', title: 'Certificate in …' },
];

function EducationStep({ store, reload, done, next }: Ctx) {
  const [level, setLevel] = useState(LEVELS[0].id);
  const [org, setOrg] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [studying, setStudying] = useState(true);

  const existing = store.experience.filter((e) => e.kind === 'education');

  return (
    <div className="space-y-3">
      {existing.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {existing.map((e) => <Badge key={e.id} tone="violet">{e.org}</Badge>)}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Level" value={level} onChange={(e) => {
          setLevel(e.target.value);
          setTitle(LEVELS.find((l) => l.id === e.target.value)?.title ?? '');
        }}>
          {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </Select>
        <Field label="Institution name" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Your school or university" />
        <Field label="What you studied" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Business administration" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" value={start} onChange={(e) => setStart(e.target.value)} placeholder="2022" />
          <Field label={studying ? 'Expected finish' : 'Finished'} value={end} onChange={(e) => setEnd(e.target.value)} placeholder="2026" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" checked={studying} onChange={(e) => setStudying(e.target.checked)} className="accent-brand-600" />
        I am still studying this
      </label>

      <SaveBar
        disabled={!org.trim()}
        label={existing.length ? 'Add another and continue' : 'Save and continue'}
        onSave={async () => {
          await api.create('experience', {
            kind: 'education', org: org.trim(), title: title.trim(), start_date: start, end_date: end,
            bullets: '[]', sort_order: store.experience.length,
          });
          setOrg(''); setStart(''); setEnd('');
          await reload();
          done('education');
        }}
        extra={<Button variant="ghost" onClick={next}>Continue →</Button>}
      />
      <p className="text-xs text-ink-500">
        Only add a grade if it helps you. Nobody asks for a number you did not volunteer.
      </p>
    </div>
  );
}

const EVIDENCE = [
  'A job of any kind — retail, hospitality, delivery, admin, a shift anywhere',
  'A university or school project you can describe',
  'A club, student union, society or team role',
  'Tutoring, teaching, coaching',
  'A family business you helped run',
  'Sport at any competitive level',
  'Volunteering',
  'Freelance work, a side project, a shop, a channel',
];

function ExperienceStep({ store, reload, done, next }: Ctx) {
  const [org, setOrg] = useState('');
  const [role, setRole] = useState('');
  const [kind, setKind] = useState<Experience['kind']>('work');
  const [targetId, setTargetId] = useState<number | ''>('');
  const [verb, setVerb] = useState('');
  const [what, setWhat] = useState('');
  const [scale, setScale] = useState('');
  const [result, setResult] = useState('');

  const entries = store.experience.filter((e) => e.kind !== 'education');
  const target = store.experience.find((e) => e.id === targetId) ?? entries[0];

  const bullet = [verb.trim(), what.trim(), scale.trim() && `for ${scale.trim()}`, result.trim() && `— ${result.trim()}`]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ');

  return (
    <div className="space-y-4">
      <details className="rounded-lg border border-line bg-sunken/60 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-ink-900">I don’t have any work experience</summary>
        <p className="mt-2 text-ink-700">Then you use one of these instead. All of them count, and all of them are normal on a first CV:</p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {EVIDENCE.map((e) => <li key={e} className="text-xs text-ink-700">• {e}</li>)}
        </ul>
      </details>

      <div className="rounded-xl border border-line p-4">
        <p className="mb-3 text-sm font-medium text-ink-900">1. Where did it happen?</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Place" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Company, club, project…" />
          <Field label="Your role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Intern, volunteer, president…" />
          <Select label="Section" value={kind} onChange={(e) => setKind(e.target.value as Experience['kind'])}>
            <option value="work">Work experience</option>
            <option value="extra">Activities & leadership</option>
          </Select>
        </div>
        <div className="mt-3">
          <Button variant="primary" disabled={!org.trim()} onClick={async () => {
            const created = await api.create<Experience>('experience', {
              kind, org: org.trim(), title: role.trim(), bullets: '[]', sort_order: store.experience.length,
            });
            setOrg(''); setRole('');
            await reload();
            setTargetId(created.id);
          }}>Add it</Button>
        </div>
        {entries.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {entries.map((e) => <Badge key={e.id} tone={e.kind === 'work' ? 'sky' : 'amber'}>{e.org} · {parseBullets(e.bullets).length}</Badge>)}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
        <p className="mb-1 text-sm font-medium text-ink-900">2. Now describe one thing you did there</p>
        <p className="mb-3 text-xs text-ink-500">Fill what you can. The sentence builds itself underneath.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Doing word" value={verb} onChange={(e) => setVerb(e.target.value)} placeholder="Organised / Sold / Built / Taught" />
          <Field label="What" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="the end-of-year event" />
          <Field label="How big" value={scale} onChange={(e) => setScale(e.target.value)} placeholder="200 people" />
          <Field label="What came of it" value={result} onChange={(e) => setResult(e.target.value)} placeholder="raised $4,000, double last year" />
        </div>
        <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          {bullet ? <span className="text-ink-900">• {bullet}{bullet.endsWith('.') ? '' : '.'}</span>
                  : <span className="text-ink-400">Your line appears here.</span>}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Select label="Add to" value={target?.id ?? ''} onChange={(e) => setTargetId(Number(e.target.value))} className="w-56">
            {entries.map((e) => <option key={e.id} value={e.id}>{e.org}</option>)}
          </Select>
          <Button variant="primary" disabled={!target || !bullet.trim()} onClick={async () => {
            if (!target) return;
            const bs = parseBullets(target.bullets);
            bs.push({ text: bullet.endsWith('.') ? bullet : `${bullet}.`, es: '', tracks: [] });
            await api.update('experience', target.id, { bullets: JSON.stringify(bs) });
            setVerb(''); setWhat(''); setScale(''); setResult('');
            await reload();
            done('experience');
          }}>Add this line</Button>
          <Button variant="ghost" onClick={() => { done('experience'); next(); }}>Done adding →</Button>
        </div>
      </div>
    </div>
  );
}

function NumbersStep({ store, done, next }: Ctx) {
  const rows = store.experience.flatMap((e) => parseBullets(e.bullets).map((b) => ({ org: e.org, text: b.text, ok: hasDigit(b.text) })));
  const without = rows.filter((r) => !r.ok);

  return (
    <div className="space-y-3">
      {rows.length === 0 ? <p className="text-sm text-ink-500">Nothing to check yet.</p>
        : without.length === 0 ? <p className="text-sm text-emerald-700">Every line has a number. That is rarer than you would think.</p>
        : (
          <>
            <p className="text-sm text-ink-700">{rows.length - without.length} of {rows.length} lines have a number. These do not:</p>
            <ul className="space-y-1">
              {without.slice(0, 8).map((r, i) => (
                <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-ink-700">
                  <span className="text-xs text-ink-500">{r.org}: </span>{r.text}
                </li>
              ))}
            </ul>
            <Link to="/profile"><Button variant="primary">Edit them</Button></Link>
          </>
        )}
      <Button variant="ghost" onClick={() => { done('numbers'); next(); }}>Continue →</Button>
    </div>
  );
}

function AIKey({ reload, done, next }: Ctx) {
  const [status, setStatus] = useState<{ configured: boolean; source: string; model: string; hint: string } | null>(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { void api.aiStatus().then(setStatus).catch(() => setStatus(null)); }, []);

  return (
    <div className="space-y-3">
      {status?.configured ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="emerald">connected</Badge>
          <span className="text-sm text-ink-700">key ending {status.hint} · {status.model} · from {status.source === 'env' ? 'your .env file' : 'this app'}</span>
        </div>
      ) : (
        <ol className="space-y-1.5 text-sm text-ink-700">
          <li className="flex gap-2"><span className="text-brand-500">1.</span>
            <span>Go to <a className="text-brand-700 underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a> and create a key. It is free to make.</span></li>
          <li className="flex gap-2"><span className="text-brand-500">2.</span><span>Copy it and paste it below.</span></li>
        </ol>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Google AI API key" type="password" value={key} onChange={(e) => setKey(e.target.value)}
               placeholder="paste your key here" className="min-w-64 flex-1" autoComplete="off" />
        <Button variant="primary" disabled={!key.trim()} onClick={async () => {
          const s = await api.aiSetKey(key.trim());
          setStatus(s);
          setKey('');
          setMsg('Saved. The next two steps now work.');
          await reload();
          done('key');
        }}>Save key</Button>
        {status?.configured && (
          <Button variant="ghost" onClick={async () => { setStatus(await api.aiSetKey('')); setMsg('Key removed.'); }}>Remove</Button>
        )}
        <Button variant="ghost" onClick={next}>Continue →</Button>
      </div>

      {msg && <p className="text-sm text-brand-700">{msg}</p>}
      <p className="text-xs text-ink-500">
        Stored on this machine only — in your local database, or in a <code>.env</code> file if you would rather
        keep it out of the database entirely (set <code>GOOGLE_API_KEY</code> there). Google charges your account for
        what you use; this app only calls it when you press a button.
      </p>
    </div>
  );
}

function AIBullets({ store, reload, done, next }: Ctx) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<BulletSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const rows = store.experience.flatMap((e) =>
    parseBullets(e.bullets).map((b, i) => ({ key: `${e.id}:${i}`, expId: e.id, index: i, org: e.org, text: b.text })));

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const run = async () => {
    const picked = rows.filter((r) => selected.has(r.key));
    if (!picked.length) return;
    setBusy(true); setErr('');
    try {
      const res = await api.aiBullets({
        bullets: picked.map((p) => p.text),
        track: (JSON.parse(store.setting['tracks'] || '[]') as string[])[0] ?? '',
        lang: 'en',
      });
      setSuggestions(res.suggestions);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const accept = async (s: BulletSuggestion) => {
    const row = rows.find((r) => r.text === s.original);
    if (!row) return;
    const exp = store.experience.find((e) => e.id === row.expId);
    if (!exp) return;
    const bs = parseBullets(exp.bullets);
    bs[row.index] = { ...bs[row.index], text: s.improved };
    await api.update('experience', exp.id, { bullets: JSON.stringify(bs) });
    setSuggestions((list) => list.filter((x) => x !== s));
    await reload();
    done('rewrite');
  };

  if (!rows.length) return <p className="text-sm text-ink-500">Add some lines to your CV first.</p>;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {rows.map((r) => (
          <label key={r.key} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sunken">
            <input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)} className="mt-0.5 accent-brand-600" />
            <span className="text-ink-700"><span className="text-xs text-ink-400">{r.org}: </span>{r.text}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setSelected(new Set(rows.map((r) => r.key)))}>Select all</Button>
        <Button variant="primary" disabled={!selected.size || busy} onClick={run}>
          {busy ? 'Thinking…' : `Improve ${selected.size || ''} with AI`}
        </Button>
        <Button variant="ghost" onClick={() => { done('rewrite'); next(); }}>Continue →</Button>
      </div>

      {err && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{err}</p>}

      {suggestions.map((s, i) => (
        <Card key={i} className="animate-rise space-y-2 p-3 text-sm">
          <p className="text-ink-400 line-through">{s.original}</p>
          <p className="font-medium text-ink-900">{s.improved}</p>
          <p className="text-xs text-ink-500">{s.why}</p>
          {s.needs?.length > 0 && (
            <p className="text-xs text-amber-700">It needs from you: {s.needs.join(' · ')}</p>
          )}
          <div className="flex gap-2">
            <Button variant="soft" onClick={() => accept(s)}>Use this</Button>
            <Button variant="ghost" onClick={() => setSuggestions((l) => l.filter((x) => x !== s))}>Keep mine</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function AIReview({ store, reload, done, next }: Ctx) {
  const [summary, setSummary] = useState('');
  const [review, setReview] = useState<{ verdict: string; strengths: string[]; fixes: { problem: string; fix: string; where: string }[]; missing: string[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const track = (() => { try { return (JSON.parse(store.setting['tracks'] || '[]') as Track[])[0] ?? 'other'; } catch { return 'other' as Track; } })();
  const cv = buildCV(store.profile, store.experience, { track, lang: 'en', template: 'ats', maxBullets: 99 });

  const call = async (what: 'summary' | 'review') => {
    setBusy(what); setErr('');
    try {
      if (what === 'summary') {
        const res = await api.aiSummary({
          headline: store.profile.headline,
          bullets: store.experience.flatMap((e) => parseBullets(e.bullets).map((b) => b.text)),
          track, lang: 'en',
        });
        setSummary(res.text);
      } else {
        const res = await api.aiReview({ cv, track });
        setReview(res.review);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy !== ''} onClick={() => call('summary')}>
          {busy === 'summary' ? 'Writing…' : 'Write my profile paragraph'}
        </Button>
        <Button variant="soft" disabled={busy !== ''} onClick={() => call('review')}>
          {busy === 'review' ? 'Reading…' : 'Review my whole CV'}
        </Button>
        <Button variant="ghost" onClick={() => { done('profile-para'); next(); }}>Continue →</Button>
      </div>

      {err && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{err}</p>}

      {summary && (
        <Card className="animate-rise space-y-2 p-3">
          <Area rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
          <SaveBar label="Use this as my profile" onSave={async () => {
            await api.saveProfile({ summary });
            await reload();
            done('profile-para');
          }} />
        </Card>
      )}

      {review && (
        <Card className="animate-rise space-y-3 p-4 text-sm">
          <p className="font-medium text-ink-900">{review.verdict}</p>
          {review.strengths?.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-500">Working</p>
              <ul className="mt-1 space-y-0.5 text-emerald-700">{review.strengths.map((x, i) => <li key={i}>✓ {x}</li>)}</ul>
            </div>
          )}
          {review.fixes?.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-500">Fix these</p>
              <ul className="mt-1 space-y-2">
                {review.fixes.map((f, i) => (
                  <li key={i} className="rounded-lg border border-line px-3 py-2">
                    <p className="text-ink-900">{f.problem}</p>
                    <p className="text-ink-700">→ {f.fix}</p>
                    <p className="text-xs text-ink-400">{f.where}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.missing?.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-ink-500">Missing</p>
              <ul className="mt-1 space-y-0.5 text-amber-700">{review.missing.map((x, i) => <li key={i}>• {x}</li>)}</ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function JobsStep({ done, next }: Ctx) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <a href="https://www.linkedin.com/jobs/" target="_blank" rel="noreferrer">
          <Button variant="primary">1. Open LinkedIn jobs ↗</Button>
        </a>
        <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noreferrer">
          <Button variant="soft">2. Request my LinkedIn data ↗</Button>
        </a>
        <Link to="/jobs"><Button>3. Import them here</Button></Link>
      </div>
      <ul className="space-y-1.5 text-sm text-ink-700">
        <li className="flex gap-2"><span className="text-brand-500">→</span><span>Search on LinkedIn and press <strong>Save</strong> on anything that looks right. Twenty is plenty to start.</span></li>
        <li className="flex gap-2"><span className="text-brand-500">→</span><span>Request your data export — it arrives by email, sometimes in minutes. The file you want is <code>Saved Jobs.csv</code>.</span></li>
        <li className="flex gap-2"><span className="text-brand-500">→</span><span>In a hurry? On the Jobs screen you can paste a search results page straight in and it works immediately.</span></li>
      </ul>
      <Button variant="ghost" onClick={() => { done('linkedin'); next(); }}>I’ve got jobs in →</Button>
    </div>
  );
}

function BackupStep({ reload, done, next }: Ctx) {
  const [msg, setMsg] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={async () => {
          const res = await fetch('/api/backup');
          const blob = await res.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `career-lab-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
          await api.setSetting('step:backup', 'done');
          await reload();
          done('backup');
          setMsg('Downloaded. Put it somewhere that is not this laptop.');
        }}>Download a backup</Button>
        <Button variant="ghost" onClick={next}>Continue →</Button>
      </div>
      {msg && <p className="text-sm text-brand-700">{msg}</p>}
    </div>
  );
}
