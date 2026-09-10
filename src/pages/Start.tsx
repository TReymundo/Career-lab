import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, Badge, Button, Card, Field, Select, SectionTitle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { QUESTIONS } from '../lib/questions.ts';
import { parseBullets, type Experience, type ParsedCV, type Store } from '../lib/types.ts';

/**
 * The guided path. Every step says what to do, why it matters, and does the doing inline —
 * so nothing here requires knowing which screen to open next. Steps mark themselves complete
 * from your actual data wherever that is possible, and only fall back to a manual tick when
 * the work happens outside the app.
 */

interface Step {
  id: string;
  title: string;
  why: string;
  minutes: number;
  done: (s: Store) => boolean;
  manual?: boolean;
  render?: (ctx: Ctx) => React.ReactNode;
}

interface Ctx { store: Store; reload: () => Promise<void> }

const hasDigit = (s: string) => /\d/.test(s);
const allBullets = (s: Store) => s.experience.flatMap((e) => parseBullets(e.bullets));

const STEPS: Step[] = [
  {
    id: 'cv-source',
    title: 'Start from a CV you already have — or from nothing',
    why: 'If you have any CV, even an old or bad one, importing it saves you an hour of typing. If you have none at all, that is completely fine: the next steps build one from scratch.',
    minutes: 5,
    done: (s) => s.experience.length > 0,
    render: (ctx) => <CVSource {...ctx} />,
  },
  {
    id: 'identity',
    title: 'Your name and contact details',
    why: 'Every document generated here puts this block at the top. A CV that reaches a recruiter without a phone number gets binned by an administrator, not by a hiring manager.',
    minutes: 3,
    done: (s) => Boolean(s.profile.name.trim() && s.profile.email.trim() && !s.profile.name.includes('[')),
    render: (ctx) => <Identity {...ctx} />,
  },
  {
    id: 'education',
    title: 'Add ITBA',
    why: 'You graduate at the end of the year, which makes education the strongest thing on your CV right now — banks and consultancies both read it first for a student. Put the expected graduation date in, explicitly.',
    minutes: 3,
    done: (s) => s.experience.some((e) => e.kind === 'education' && e.org.trim() && !e.org.includes('[')),
    render: (ctx) => <QuickEntry kind="education" label="ITBA" {...ctx} />,
  },
  {
    id: 'experience',
    title: 'Add your experience — including if you think you have none',
    why: 'You have a J.P. Morgan internship, which is more than most applicants. But if you had nothing at all, this step still works: coursework, clubs, sport, tutoring, a family business and volunteering are all evidence, and recruiters read them as such when they are written properly.',
    minutes: 15,
    done: (s) => s.experience.some((e) => (e.kind === 'work' || e.kind === 'extra') && parseBullets(e.bullets).length > 0),
    render: (ctx) => <ExperienceBuilder {...ctx} />,
  },
  {
    id: 'numbers',
    title: 'Put a number in every bullet',
    why: 'This is the single highest-return edit on the whole CV. “Improved the reporting process” means nothing; “cut it from 90 to 20 minutes” is a fact someone can ask you about. Aim for a number in at least three quarters of your bullets.',
    minutes: 20,
    done: (s) => {
      const bs = allBullets(s).filter((b) => !b.text.includes('['));
      return bs.length >= 3 && bs.filter((b) => hasDigit(b.text)).length / bs.length >= 0.7;
    },
    render: (ctx) => <NumberCheck {...ctx} />,
  },
  {
    id: 'tracks',
    title: 'Tag your bullets by track',
    why: 'The same work sells differently to a trading desk and to a consultancy. Tagging lets one master CV produce a Markets version and a Consulting version without you maintaining two files that slowly drift apart.',
    minutes: 10,
    done: (s) => allBullets(s).some((b) => b.tracks.length > 0),
    render: () => (
      <Guidance
        to="/profile"
        cta="Open Master CV"
        points={[
          'Expand an entry and use the chips under each bullet: S&T, IB, Consulting, Product.',
          'Leave a bullet untagged when it belongs on every version — most should be untagged.',
          'Tag only the two or three bullets per role that are genuinely track-specific.',
        ]}
      />
    ),
  },
  {
    id: 'spanish',
    title: 'Write the Spanish versions',
    why: 'You are applying in Buenos Aires. Local processes will want a CV in Spanish, and a machine-translated one reads badly to a native reviewer. Write the Spanish yourself, once, in the ES box beside each bullet.',
    minutes: 25,
    done: (s) => Boolean(s.profile.summary_es.trim()) && allBullets(s).some((b) => b.es?.trim()),
    render: () => (
      <Guidance
        to="/profile"
        cta="Open Master CV"
        points={[
          'Fill the “Versión en español” block: titular, perfil, competencias, idiomas.',
          'Then the ES box beside each bullet. Anything left empty falls back to English and gets flagged.',
          'Write it, do not translate it — the Spanish should sound like you wrote it first.',
        ]}
      />
    ),
  },
  {
    id: 'jobs',
    title: 'Get some jobs in',
    why: 'Nothing else in the app does anything until there are openings to work on. The fastest route is LinkedIn’s own data export: save jobs as you browse, request the archive once, import the CSV.',
    minutes: 10,
    done: (s) => s.setting['step:jobs'] === 'done',
    manual: true,
    render: () => (
      <Guidance
        to="/jobs"
        cta="Open Jobs → Import"
        points={[
          'LinkedIn → Settings → Data privacy → Get a copy of your data. It arrives by email, sometimes within minutes, sometimes a day.',
          'Meanwhile: paste a search results page into the paste importer, it works immediately.',
          'Then search with the grammar: sales trading "buenos aires" -senior.',
        ]}
      />
    ),
  },
  {
    id: 'pack',
    title: 'Generate your first document pack',
    why: 'Check a job, press Generate CV, then Generate full pack. You get a CV, cover letter, outreach message, interview prep sheet and a tailoring plan for that specific posting — and you find out immediately which parts of your master CV are still thin.',
    minutes: 5,
    done: (s) => s.document.length > 0,
    render: () => (
      <Guidance
        to="/jobs"
        cta="Open Jobs"
        points={[
          'Tick a job, choose the track and language, press Generate CV.',
          'In the generator, press “Generate full pack” to write all five documents at once.',
          'Read the Checks panel — unfilled placeholders and missing ATS keywords are listed there.',
        ]}
      />
    ),
  },
  {
    id: 'export',
    title: 'Export a real file and look at it',
    why: 'No application form accepts Markdown. Export the CV as DOCX and PDF, open both, and read them as a stranger would. Most CV problems are visible in ten seconds and invisible in an editor.',
    minutes: 5,
    done: (s) => s.setting['step:export'] === 'done',
    manual: true,
    render: () => (
      <Guidance
        to="/documents"
        cta="Open Documents"
        points={[
          'Use Download DOCX for application forms — most parsers read Word more reliably than PDF.',
          'Use Download PDF for anything you email or hand over directly.',
          'The file is named for you: Surname_Name_CV_Firm_EN.pdf.',
        ]}
      />
    ),
  },
  {
    id: 'answers',
    title: 'Write the three answers every form asks',
    why: 'Application forms, not CVs, are where the hours disappear. Why this firm, a leadership story, a failure story — write them once and you will paste them for the next six months.',
    minutes: 45,
    done: (s) => s.answer.filter((a) => !a.company && (a.body.trim() || a.body_es.trim())).length >= 3,
    render: (ctx) => (
      <Guidance
        to="/answers"
        cta="Open Answer bank"
        points={[
          `${ctx.store.answer.filter((a) => !a.company && a.body.trim()).length} of ${QUESTIONS.length} master answers written so far.`,
          'Start with: why this firm, a leadership story, a failure story.',
          'Each has a word limit and a coaching note. Keep to the limit — forms truncate silently.',
        ]}
      />
    ),
  },
  {
    id: 'network',
    title: 'Add three real people and a date to contact them',
    why: 'This decides your internal move far more than any document does. For a J.P. Morgan Markets seat you need time in role, your manager’s sign-off, and someone on the receiving desk who wants you. Only the third one is invisible from your desk today.',
    minutes: 15,
    done: (s) => s.contact.filter((c) => c.name.trim() && c.next_touch).length >= 3,
    render: () => (
      <Guidance
        to="/contacts"
        cta="Open Network"
        points={[
          'Three names to start: someone on the desk you want, an ITBA alum who made a similar move, and whoever runs graduate recruiting internally.',
          'Give every one of them a follow-up date. A contact without a date is a contact you will forget.',
          'Generate the outreach DM in Documents — three sentences, nothing longer.',
        ]}
      />
    ),
  },
  {
    id: 'cycles',
    title: 'Find out when the graduate cycles actually open',
    why: 'Graduate recruiting runs on fixed dates and closing early when full. Missing a window costs you a year, not a week. This one you have to research yourself — I will not invent dates that decide your calendar.',
    minutes: 30,
    done: (s) => s.setting['step:cycles'] === 'done',
    manual: true,
    render: () => (
      <Guidance
        points={[
          'Check the graduate careers page of every firm on your list for the class you graduate into.',
          'For the internal J.P. Morgan move, ask your manager and HR directly when Markets and IB recruiting opens and what the internal-mobility rules are — time in seat is usually the binding constraint.',
          'For MBB in Buenos Aires, application windows and the ITBA careers office calendar are the two things to check.',
          'Put each date into the pipeline as a deadline on that application, then tick this step.',
        ]}
      />
    ),
  },
  {
    id: 'backup',
    title: 'Take a backup',
    why: 'Everything lives in one file on one laptop. One disk failure in November and the whole search is gone at the worst possible moment. Download the JSON and put it somewhere synced.',
    minutes: 2,
    done: (s) => s.setting['step:backup'] === 'done',
    manual: true,
    render: (ctx) => <Backup {...ctx} />,
  },
];

export default function Start({ store, reload }: Ctx) {
  const [open, setOpen] = useState<string | null>(null);

  const state = useMemo(() => STEPS.map((s) => ({ step: s, done: s.done(store) })), [store]);
  const doneCount = state.filter((s) => s.done).length;
  const firstOpen = state.find((s) => !s.done)?.step.id ?? null;
  const active = open ?? firstOpen;
  const remaining = state.filter((s) => !s.done).reduce((n, s) => n + s.step.minutes, 0);

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-3xl font-semibold tabular-nums text-ink-900">
              {doneCount}<span className="text-ink-400">/{STEPS.length}</span>
            </p>
            <p className="text-sm text-ink-500">
              steps done · about {Math.round(remaining / 60 * 10) / 10} hours of work left, spread over a few evenings
            </p>
          </div>
          {doneCount === STEPS.length && <Badge tone="emerald">Setup complete — now it is just the work</Badge>}
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken">
          <div className="animate-bar h-full rounded-full bg-brand-500 transition-all duration-500"
               style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
        </div>
        <p className="mt-3 text-sm text-ink-500">
          Work top to bottom. Each step opens with what to do and why it matters, and most of them
          tick themselves off as soon as the data is there.
        </p>
      </Card>

      <div className="stagger space-y-2.5">
        {state.map(({ step, done }, i) => {
          const isOpen = active === step.id;
          return (
            <Card key={step.id} className={`overflow-hidden transition ${isOpen ? 'border-brand-300 shadow-[0_8px_24px_-18px_rgb(16_35_26/.5)]' : ''} ${done && !isOpen ? 'opacity-75' : ''}`}>
              <button onClick={() => setOpen(isOpen ? '' : step.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-brand-50">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition ${
                  done ? 'bg-brand-500 text-white' : 'border border-line-strong bg-surface text-ink-400'}`}>
                  {done ? '✓' : i + 1}
                </span>
                <span className={`min-w-0 flex-1 text-sm font-medium ${done ? 'text-ink-500 line-through decoration-brand-300' : 'text-ink-900'}`}>
                  {step.title}
                </span>
                <Badge tone={done ? 'emerald' : 'slate'}>{step.minutes} min</Badge>
                <span className="text-ink-400">{isOpen ? '▾' : '▸'}</span>
              </button>

              {isOpen && (
                <div className="animate-fade space-y-4 border-t border-line px-4 py-4">
                  <p className="text-sm leading-relaxed text-ink-700">{step.why}</p>
                  {step.render?.({ store, reload })}
                  {step.manual && (
                    <Button
                      variant={done ? 'subtle' : 'soft'}
                      onClick={async () => { await api.setSetting(`step:${step.id}`, done ? '' : 'done'); await reload(); }}
                    >
                      {done ? 'Mark as not done' : 'I have done this'}
                    </Button>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Guidance({ points, to, cta }: { points: string[]; to?: string; cta?: string }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5 text-sm text-ink-700">
        {points.map((p, i) => (
          <li key={i} className="flex gap-2"><span className="text-brand-500">→</span><span>{p}</span></li>
        ))}
      </ul>
      {to && <Link to={to}><Button variant="primary">{cta}</Button></Link>}
    </div>
  );
}

/** Step 1 — import an existing CV, or say you have none and move on. */
function CVSource({ reload }: Ctx) {
  const [mode, setMode] = useState<'choose' | 'paste' | 'none'>('choose');
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedCV | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const runParse = async (payload: { text?: string; base64?: string; filename?: string }) => {
    setBusy(true); setMsg('');
    try {
      const res = await api.parseCV(payload);
      setParsed(res.parsed);
      setMsg(`Read ${res.chars} characters. Check what it found below before writing it in.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    await runParse({ base64, filename: file.name });
  };

  if (mode === 'none') {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          Good — starting clean is genuinely easier than fixing a bad template. Go to the next steps in order;
          by the end of step 5 you will have a better CV than the one you would have imported.
        </p>
        <Button onClick={() => setMode('choose')}>Actually, I do have one</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {mode === 'choose' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => fileRef.current?.click()}>Upload a CV file</Button>
          <Button onClick={() => setMode('paste')}>Paste the text instead</Button>
          <Button variant="ghost" onClick={() => setMode('none')}>I don’t have a CV</Button>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".docx,.txt,.md" className="hidden"
             onChange={(e) => onFile(e.target.files?.[0])} />

      <p className="text-xs text-ink-500">
        Word (.docx), plain text and Markdown are read directly. For a PDF, open it, select all, copy, and use
        “Paste the text instead” — PDF text extraction is unreliable enough that I would rather you saw exactly what went in.
      </p>

      {mode === 'paste' && (
        <div className="space-y-2">
          <Area rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs"
                placeholder="Paste the whole CV here, headings and all." />
          <Button variant="primary" disabled={busy || !text.trim()} onClick={() => runParse({ text })}>
            {busy ? 'Reading…' : 'Read it'}
          </Button>
        </div>
      )}

      {msg && <p className="rounded-lg border border-line bg-sunken px-3 py-2 text-sm text-ink-700">{msg}</p>}

      {parsed && (
        <Card className="space-y-3 p-4">
          <SectionTitle>What it found</SectionTitle>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {(['name', 'email', 'phone', 'linkedin'] as const).map((k) => (
              <div key={k} className="flex gap-2">
                <span className="w-20 shrink-0 text-xs uppercase tracking-wider text-ink-400">{k}</span>
                <span className={parsed[k] ? 'text-ink-900' : 'text-ink-400'}>{parsed[k] || 'not found'}</span>
              </div>
            ))}
          </div>
          {parsed.entries.length > 0 ? (
            <ul className="space-y-1.5 text-sm">
              {parsed.entries.map((e, i) => (
                <li key={i} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={e.kind === 'work' ? 'sky' : e.kind === 'education' ? 'violet' : 'amber'}>{e.kind}</Badge>
                    <span className="font-medium text-ink-900">{e.org || '—'}</span>
                    <span className="text-ink-500">{e.title}</span>
                    <span className="ml-auto text-xs text-ink-400">{[e.start_date, e.end_date].filter(Boolean).join(' – ')}</span>
                  </div>
                  {e.bullets.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-ink-500">
                      {e.bullets.slice(0, 3).map((b, j) => <li key={j} className="truncate">• {b}</li>)}
                      {e.bullets.length > 3 && <li>…and {e.bullets.length - 3} more</li>}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-700">
              No entries recognised. The parser looks for headings like “Experience”, “Education”,
              “Experiencia” or “Formación”. Add those headings to your pasted text and read it again,
              or just skip this and type the entries in the next steps.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={async () => {
              setBusy(true);
              const r = await api.applyCV(parsed, false);
              await reload();
              setBusy(false);
              setParsed(null);
              setMsg(`Added ${r.experiences} entries to your Master CV. Check them on the Master CV screen — the parser is a rough reader.`);
            }}>Add these to my Master CV</Button>
            <Button variant="ghost" onClick={() => { setParsed(null); setMsg(''); }}>Discard</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Identity({ store, reload }: Ctx) {
  const [draft, setDraft] = useState(store.profile);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(store.profile);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Full name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Tomás Pérez" />
        <Field label="Email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />
        <Field label="Phone" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+54 9 11 …" />
        <Field label="Location" value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder="Buenos Aires, Argentina" />
        <Field label="LinkedIn" value={draft.linkedin} onChange={(e) => set({ linkedin: e.target.value })} placeholder="linkedin.com/in/…" />
      </div>
      <Button variant="primary" disabled={!dirty}
              onClick={async () => { await api.saveProfile(draft as unknown as Record<string, string>); await reload(); }}>
        {dirty ? 'Save' : 'Saved'}
      </Button>
    </div>
  );
}

function QuickEntry({ kind, label, store, reload }: Ctx & { kind: Experience['kind']; label: string }) {
  const existing = store.experience.filter((e) => e.kind === kind);
  const [org, setOrg] = useState('Instituto Tecnológico de Buenos Aires (ITBA)');
  const [title, setTitle] = useState('Licenciatura en Gestión de Negocios');
  const [start, setStart] = useState('2022');
  const [end, setEnd] = useState('Dec 2026');

  return (
    <div className="space-y-3">
      {existing.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {existing.map((e) => <Badge key={e.id} tone="violet">{e.org}</Badge>)}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Institution" value={org} onChange={(e) => setOrg(e.target.value)} className="sm:col-span-2" />
        <Field label="Degree" value={title} onChange={(e) => setTitle(e.target.value)} className="sm:col-span-2" />
        <Field label="From" value={start} onChange={(e) => setStart(e.target.value)} />
        <Field label="To (expected)" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <Button variant="primary" onClick={async () => {
        await api.create('experience', { kind, org, title, start_date: start, end_date: end, bullets: '[]', sort_order: store.experience.length });
        await reload();
      }}>
        Add {label}
      </Button>
      <p className="text-xs text-ink-500">
        Add your GPA as a bullet on the Master CV screen if it is strong. If it is not, leave it off — nobody asks
        for a number you did not volunteer.
      </p>
    </div>
  );
}

const EVIDENCE = [
  { what: 'A university project or your capstone', how: 'Treat it like a job: the problem, your method, the result, who saw it.' },
  { what: 'A club, centro de estudiantes, or society role', how: 'How many people, what budget, what you organised, what changed because of you.' },
  { what: 'Tutoring or teaching', how: 'How many students, over how long, what happened to their results.' },
  { what: 'A family business you helped in', how: 'This counts, and Argentine recruiters know it counts. What did you actually run or fix?' },
  { what: 'Sport at any competitive level', how: 'Training hours a week, years, any team you captained. It reads as discipline, which is the point.' },
  { what: 'Volunteering', how: 'The organisation, the hours, what you were responsible for.' },
  { what: 'Freelance or a side project', how: 'Clients, revenue, users — any number you actually have.' },
  { what: 'A case competition or a finance club', how: 'Where you placed, out of how many teams, and what your role in the team was.' },
];

/** Step 4 — turns an activity into a bullet with the shape recruiters expect. */
function ExperienceBuilder({ store, reload }: Ctx) {
  const [targetId, setTargetId] = useState<number | ''>(store.experience[0]?.id ?? '');
  const [verb, setVerb] = useState('');
  const [what, setWhat] = useState('');
  const [scale, setScale] = useState('');
  const [result, setResult] = useState('');
  const [newOrg, setNewOrg] = useState('');
  const [newKind, setNewKind] = useState<Experience['kind']>('extra');

  const bullet = [
    verb.trim(),
    what.trim(),
    scale.trim() && `for ${scale.trim()}`,
    result.trim() && `— ${result.trim()}`,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ');

  const target = store.experience.find((e) => e.id === targetId);

  const addBullet = async () => {
    if (!target || !bullet.trim()) return;
    const bs = parseBullets(target.bullets);
    bs.push({ text: bullet.endsWith('.') ? bullet : `${bullet}.`, es: '', tracks: [] });
    await api.update('experience', target.id, { bullets: JSON.stringify(bs) });
    await reload();
    setVerb(''); setWhat(''); setScale(''); setResult('');
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-ink-900">If you think you have no experience, you have some of these:</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {EVIDENCE.map((e) => (
            <li key={e.what} className="rounded-lg border border-line px-3 py-2 text-sm">
              <span className="font-medium text-ink-900">{e.what}</span>
              <span className="mt-0.5 block text-xs text-ink-500">{e.how}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-line bg-sunken/60 p-4">
        <p className="mb-3 text-sm font-medium text-ink-900">Add the place it happened</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Organisation / club / project" value={newOrg} onChange={(e) => setNewOrg(e.target.value)}
                 placeholder="Centro de Estudiantes ITBA" className="min-w-56 flex-1" />
          <Select label="Section" value={newKind} onChange={(e) => setNewKind(e.target.value as Experience['kind'])} className="w-52">
            <option value="work">Experience</option>
            <option value="extra">Leadership & extracurricular</option>
            <option value="education">Education</option>
          </Select>
          <Button variant="primary" disabled={!newOrg.trim()} onClick={async () => {
            const created = await api.create<Experience>('experience', {
              kind: newKind, org: newOrg.trim(), bullets: '[]', sort_order: store.experience.length,
            });
            setNewOrg('');
            await reload();
            setTargetId(created.id);
          }}>Add</Button>
        </div>
      </div>

      <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
        <p className="mb-1 text-sm font-medium text-ink-900">Now write one bullet</p>
        <p className="mb-3 text-xs text-ink-500">
          Strong verb → what you did → how big it was → what changed. Fill what you can; the shape is the point.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Strong verb" value={verb} onChange={(e) => setVerb(e.target.value)} placeholder="Organised / Built / Led / Automated" />
          <Field label="What you did" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="the annual careers fair" />
          <Field label="How big" value={scale} onChange={(e) => setScale(e.target.value)} placeholder="14 companies and 300 students" />
          <Field label="What changed (a number if you have one)" value={result} onChange={(e) => setResult(e.target.value)}
                 placeholder="attendance up 40% on the prior year" />
        </div>

        <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          {bullet ? <span className="text-ink-900">• {bullet}{bullet.endsWith('.') ? '' : '.'}</span>
                  : <span className="text-ink-400">Your bullet will appear here as you type.</span>}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Select label="Add it to" value={targetId} onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : '')} className="w-64">
            <option value="">— pick an entry —</option>
            {store.experience.map((e) => <option key={e.id} value={e.id}>{e.org || 'untitled'}</option>)}
          </Select>
          <Button variant="primary" disabled={!target || !bullet.trim()} onClick={addBullet}>Add bullet</Button>
        </div>
      </div>
    </div>
  );
}

function NumberCheck({ store }: Ctx) {
  const rows = store.experience.flatMap((e) =>
    parseBullets(e.bullets).map((b) => ({ org: e.org, text: b.text, ok: hasDigit(b.text) })),
  );
  const without = rows.filter((r) => !r.ok);

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-ink-500">No bullets yet — finish the step above first.</p>
      ) : without.length === 0 ? (
        <p className="text-sm text-emerald-700">Every bullet has a number in it. That is rarer than you would think.</p>
      ) : (
        <>
          <p className="text-sm text-ink-700">
            {rows.length - without.length} of {rows.length} bullets have a number.
            These do not — open Master CV and give each one a figure, a count, a percentage or a timeframe:
          </p>
          <ul className="space-y-1">
            {without.slice(0, 8).map((r, i) => (
              <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-ink-700">
                <span className="text-xs text-ink-500">{r.org}: </span>{r.text}
              </li>
            ))}
          </ul>
          <Link to="/profile"><Button variant="primary">Open Master CV</Button></Link>
        </>
      )}
    </div>
  );
}

function Backup({ reload }: Ctx) {
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3">
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
          setMsg('Downloaded. Put it in Drive, Dropbox or anywhere that is not this laptop.');
        }}>Download backup</Button>
        <Button onClick={() => fileRef.current?.click()}>Restore from a backup</Button>
      </div>
      <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!confirm('Restoring replaces everything currently in the app with the contents of this file. Continue?')) return;
        const parsed = JSON.parse(await file.text());
        const res = await fetch('/api/restore', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: parsed.data ?? parsed }),
        }).then((r) => r.json());
        await reload();
        setMsg(res.error ? String(res.error) : `Restored: ${Object.entries(res.restored ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
      }} />
      {msg && <p className="rounded-lg border border-line bg-sunken px-3 py-2 text-sm text-ink-700">{msg}</p>}
    </div>
  );
}
