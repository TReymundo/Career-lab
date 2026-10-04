import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Field } from '../components/ui.tsx';
import { api, type AiStatus, type FieldEdit, type FieldItem } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import CVStudio from '../components/CVStudio.tsx';
import KeyBox, { useAiStatus } from '../components/KeyBox.tsx';
import { buildCV, detectLang } from '../lib/templates.ts';
import { bulletRows, hasDigit, runChecks, type Check } from '../lib/cvcheck.ts';
import { parseBullets, type ParsedCV, type Store, type Track } from '../lib/types.ts';
import { ContactQ, EducationQ, ExperienceQ, NameQ, NumberQ, SkillsQ, TargetQ, type QProps } from '../components/questions.tsx';
import CVReveal from '../components/CVReveal.tsx';
import { toast } from '../components/Toast.tsx';

/**
 * One question per screen.
 *
 * It opens on the only question that decides everything else — do you already have a CV? —
 * then takes one of two paths that meet at the same review:
 *
 *   upload → what we found → only the questions the file could not answer → review
 *   build  → name → contact → target → education → experience → skills    → review
 *
 * Where you are is saved, so leaving and coming back resumes on the same screen.
 */

type Path = 'upload' | 'build';
interface Flow { path: Path | null; seq: string[]; at: number }

// Experience and skills are not forms any more: they come out of the "get to know you" chat.
const BUILD = ['name', 'contact', 'target', 'education'];
const MAX_NUMBER_QUESTIONS = 5;

const firstTrack = (s: Store): Track => {
  try { return (JSON.parse(s.setting['tracks'] || '[]') as Track[])[0] ?? 'other'; } catch { return 'other'; }
};

/** After an upload: the questions whose answers the file did not contain, and nothing else. */
function gapsFor(s: Store): string[] {
  const p = s.profile;
  const done = s.experience.filter((e) => e.kind !== 'education');
  const out: string[] = [];
  if (!p.name.trim()) out.push('name');
  if (!p.email.trim() || !p.phone.trim() || !p.location.trim()) out.push('contact');
  if (!p.headline.trim()) out.push('target');
  if (!s.experience.some((e) => e.kind === 'education')) out.push('education');
  out.push(...numberGaps(s).slice(0, MAX_NUMBER_QUESTIONS));
  return out;
}

const numberGaps = (s: Store) => {
  const work = new Set(s.experience.filter((e) => e.kind !== 'education').map((e) => e.id));
  return bulletRows(s).filter((r) => work.has(r.expId) && !hasDigit(r.text)).map((r) => `num:${r.expId}:${r.index}`);
};

function initialFlow(store: Store): Flow {
  // "/cv?fresh=1" shows the first question without touching saved progress (until you act).
  if (new URLSearchParams(window.location.search).has('fresh')) return { path: null, seq: ['choose'], at: 0 };
  try {
    const saved = JSON.parse(store.setting['flow'] || 'null') as Flow | null;
    if (saved && Array.isArray(saved.seq) && saved.seq.length) return { ...saved, at: Math.min(saved.at, saved.seq.length - 1) };
  } catch { /* fall through */ }
  // Someone who already has a CV from the old setup lands on the review, not on question one.
  const started = Boolean(store.profile.name.trim()) || store.experience.length > 0;
  return started ? { path: 'build', seq: ['choose', 'review'], at: 1 } : { path: null, seq: ['choose'], at: 0 };
}

export default function Start({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const [flow, setFlowState] = useState<Flow>(() => initialFlow(store));
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [parsed, setParsed] = useState<{ cv: ParsedCV; via: 'ai' | 'rules' } | null>(null);
  // Fixes opened from the review run as a short queue, then drop you back on the review.
  const [fixQueue, setFixQueue] = useState<string[]>([]);
  const [reveal, setReveal] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  const setFlow = (f: Flow, d: 'fwd' | 'back' = 'fwd') => {
    setDir(d);
    setFlowState(f);
    void api.setSetting('flow', JSON.stringify(f));
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const screen = fixQueue[0] ?? flow.seq[flow.at];
  const next = () => {
    if (fixQueue.length) { setDir('fwd'); setFixQueue((q) => q.slice(1)); return; }
    setFlow({ ...flow, at: Math.min(flow.at + 1, flow.seq.length - 1) });
  };
  const back = () => {
    if (fixQueue.length) { setDir('back'); setFixQueue([]); return; }
    setFlow({ ...flow, at: Math.max(flow.at - 1, 0) }, 'back');
  };

  const choose = (path: Path) => setFlow(path === 'build'
    ? { path, seq: ['choose', ...BUILD, 'review'], at: 1 }
    : { path, seq: ['choose', 'upload', 'found'], at: 1 });

  const confirmUpload = async (replace: boolean) => {
    if (!parsed) return;
    await api.applyCV(parsed.cv, replace);
    const fresh = await api.all();
    await reload();
    setParsed(null);
    const gaps = gapsFor(fresh);
    setFlow({ path: 'upload', seq: ['choose', 'upload', 'found', ...gaps, 'review'], at: 3 });
    if (!gaps.length) toast(t('Nothing missing', 'No falta nada'), t('Your CV had everything. Straight to the review.', 'Tu CV tenía todo. Directo a la revisión.'));
  };

  const fix = (c: Check) => {
    if (c.fix === 'numbers') setFixQueue(numberGaps(store).slice(0, MAX_NUMBER_QUESTIONS));
    else if (c.fix && c.fix !== 'polish' && c.fix !== 'profile') setFixQueue([c.fix]);
    setDir('fwd');
  };

  // Progress counts the questions only, not the opening choice, the upload or the review.
  const questions = flow.seq.filter((s) => !['choose', 'upload', 'found', 'review'].includes(s));
  const total = Math.max(questions.length, 1);
  const position = Math.max(questions.indexOf(screen), 0);
  const showRail = screen !== 'choose' && screen !== 'review' && !fixQueue.length;

  const q: QProps = { store, reload, onDone: next };
  const body = (() => {
    if (screen === 'choose') return <Choose onPick={choose} />;
    if (screen === 'upload' || (screen === 'found' && !parsed)) {
      return <Upload onParsed={(cv, via) => { setParsed({ cv, via }); setFlow({ ...flow, seq: ['choose', 'upload', 'found'], at: 2 }); }} />;
    }
    if (screen === 'found' && parsed) return <Found parsed={parsed.cv} via={parsed.via} store={store} onConfirm={confirmUpload} onRetry={back} />;
    if (screen === 'name') return <NameQ {...q} />;
    if (screen === 'contact') return <ContactQ {...q} />;
    if (screen === 'target') return <TargetQ {...q} />;
    if (screen === 'education') return <EducationQ {...q} />;
    if (screen === 'experience') return <ExperienceQ {...q} />;
    if (screen === 'skills') return <SkillsQ {...q} />;
    if (screen.startsWith('num:')) {
      const [, id, i] = screen.split(':');
      return <NumberQ {...q} expId={Number(id)} index={Number(i)} />;
    }
    return <CVStudio store={store} reload={reload} onFix={fix} onRestart={() => setFlow({ path: null, seq: ['choose'], at: 0 }, 'back')}
                     onUpload={() => setFlow({ path: 'upload', seq: ['choose', 'upload', 'found'], at: 1 })} />;
  })();

  return (
    <div ref={top} className={`mx-auto scroll-mt-24 ${screen === 'review' ? 'max-w-7xl' : 'max-w-2xl'}`}>
      {reveal && <CVReveal store={store} onClose={() => setReveal(false)} />}

      {screen !== 'choose' && screen !== 'review' && (
        <div className="mb-8 flex items-center gap-4">
          <button onClick={back} className="rounded-lg px-2 py-1 text-sm text-ink-500 transition hover:bg-sunken hover:text-ink-900">
            ← {fixQueue.length ? t('Back to review', 'Volver a la revisión') : t('Back', 'Atrás')}
          </button>
          {showRail && (
            <div className="flex flex-1 items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                <div className="h-full rounded-full bg-brand-500 transition-all duration-500 ease-out" style={{ width: `${(position / total) * 100}%` }} />
              </div>
              <span className="shrink-0 text-xs tabular-nums text-ink-400">
                {screen === 'upload' || screen === 'found' ? t('Reading your CV', 'Leyendo tu CV') : `${position + 1} / ${total}`}
              </span>
            </div>
          )}
        </div>
      )}

      <div key={screen} className={dir === 'fwd' ? 'animate-screen-fwd' : 'animate-screen-back'}>
        {body}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the first question */

function Choose({ onPick }: { onPick: (p: Path) => void }) {
  const t = useT();
  return (
    <div className="pt-2 sm:pt-6">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-600">{t('Let’s start with your CV', 'Empecemos por tu CV')}</p>
      <h2 className="mt-2 text-4xl font-semibold text-forest-900 sm:text-5xl">
        {t('Do you already ', '¿Ya tenés ')}<span className="italic text-brand-600">{t('have one?', 'uno?')}</span>
      </h2>
      <div className="stagger mt-10 grid gap-5 sm:grid-cols-2">
        <button onClick={() => onPick('upload')}
                className="choice group relative overflow-hidden rounded-3xl border border-line bg-surface p-7 text-left transition duration-300 hover:-translate-y-1 hover:border-brand-300 hover:shadow-2xl hover:shadow-forest-900/10">
          <UploadArt />
          <p className="mt-6 font-display text-2xl font-semibold text-forest-900">{t('Yes — upload it', 'Sí — subirlo')}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{t('Word or PDF. Everything gets pulled out, and you only answer what’s missing.', 'Word o PDF. Se extrae todo, y sólo respondés lo que falta.')}</p>
          <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-brand-700">{t('Upload my CV', 'Subir mi CV')}<span className="transition group-hover:translate-x-1">→</span></span>
        </button>
        <button onClick={() => onPick('build')}
                className="choice group relative overflow-hidden rounded-3xl bg-forest-900 p-7 text-left text-white transition duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-forest-900/25">
          <div aria-hidden className="float-slow pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-lime-400/20 blur-3xl" />
          <ChatArt />
          <p className="relative mt-6 font-display text-2xl font-semibold">{t('No — build one with me', 'No — armémoslo juntos')}</p>
          <p className="relative mt-1.5 text-sm leading-relaxed text-white/65">{t('One question at a time, about ten minutes. Never had a job? That’s fine.', 'Una pregunta a la vez, unos diez minutos. ¿Nunca trabajaste? No pasa nada.')}</p>
          <span className="relative mt-5 inline-flex items-center gap-2 text-sm font-semibold text-lime-300">{t('Start the questions', 'Empezar las preguntas')}<span className="transition group-hover:translate-x-1">→</span></span>
        </button>
      </div>
      <p className="mt-6 text-sm text-ink-400">
        {t('Either way it stays on this computer, and you can switch later.', 'De cualquier forma queda en esta computadora, y podés cambiar después.')}
      </p>
    </div>
  );
}

/** A page with lines that write themselves, and a scan line that sweeps over it on hover. */
function UploadArt() {
  return (
    <div aria-hidden className="relative h-32">
      <div className="absolute left-2 top-3 h-28 w-24 rotate-[-7deg] rounded-lg bg-sunken ring-1 ring-line transition duration-500 group-hover:rotate-[-11deg]" />
      <div className="scan-host absolute left-8 top-0 h-32 w-24 overflow-hidden rounded-lg bg-white p-3 shadow-lg ring-1 ring-line transition duration-500 group-hover:-translate-y-1.5">
        <div className="hero-line h-2 w-14 rounded bg-forest-900" style={{ animationDelay: '0s' }} />
        <div className="mt-1.5 hero-line h-1.5 w-16 rounded bg-brand-300" style={{ animationDelay: '.2s' }} />
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="mt-2 hero-line h-1 rounded bg-line-strong" style={{ width: `${55 + ((i * 13) % 35)}%`, animationDelay: `${0.4 + i * 0.15}s` }} />)}
        <span className="scan-line" />
      </div>
      <span className="absolute left-28 top-16 grid h-11 w-11 place-items-center rounded-full bg-lime-400 text-lg font-bold text-forest-950 shadow-lg transition duration-500 group-hover:-translate-y-2">↑</span>
    </div>
  );
}

/** A question bubble, a typing indicator, and an answer — the build-with-me chat in miniature. */
function ChatArt() {
  const t = useT();
  return (
    <div aria-hidden className="relative h-32 space-y-2">
      <div className="chat-1 w-fit rounded-2xl rounded-tl-md bg-white/10 px-3.5 py-2 text-xs text-white/85">{t('What have you studied?', '¿Qué estudiaste?')}</div>
      <div className="chat-2 ml-auto w-fit rounded-2xl rounded-tr-md bg-lime-400 px-3.5 py-2 text-xs font-medium text-forest-950">{t('Business at ITBA 🎓', 'Negocios en el ITBA 🎓')}</div>
      <div className="chat-3 flex w-fit items-center gap-1 rounded-2xl rounded-tl-md bg-white/10 px-3.5 py-2.5">
        {[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/70" style={{ animationDelay: `${d * 140}ms` }} />)}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- upload */

/** While a file is read, the steps tick off one by one — so a wait feels like work being done. */
function ReadingSteps() {
  const t = useT();
  const steps = [
    t('Opening your file', 'Abriendo tu archivo'),
    t('Finding your sections', 'Encontrando tus secciones'),
    t('Pulling out every job, school and line', 'Sacando cada trabajo, estudio y línea'),
    t('Checking against what recruiters look for', 'Comparando con lo que buscan los reclutadores'),
  ];
  const [at, setAt] = useState(0);
  useEffect(() => { const id = setInterval(() => setAt((a) => Math.min(a + 1, steps.length - 1)), 1700); return () => clearInterval(id); }, [steps.length]);
  return (
    <div className="flex flex-col items-center gap-6 py-4">
      <span className="scan-doc scale-150" aria-hidden />
      <ul className="w-full max-w-xs space-y-2 text-left">
        {steps.map((s, i) => (
          <li key={s} className={`flex items-center gap-2.5 text-sm transition duration-500 ${i <= at ? 'opacity-100' : 'opacity-30'}`}>
            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] transition duration-500 ${i < at ? 'bg-brand-500 text-white' : i === at ? 'bg-lime-300 text-forest-900' : 'bg-sunken text-ink-400'}`}>
              {i < at ? '✓' : i === at ? <span className="h-2 w-2 animate-ping rounded-full bg-forest-900" /> : ''}
            </span>
            <span className={i === at ? 'font-medium text-ink-900' : 'text-ink-500'}>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Upload({ onParsed }: { onParsed: (cv: ParsedCV, via: 'ai' | 'rules') => void }) {
  const t = useT();
  const [status, setStatus] = useAiStatus();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [drag, setDrag] = useState(false);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (payload: { text?: string; base64?: string; filename?: string }) => {
    setBusy(true); setMsg('');
    try {
      const res = await api.parseCV(payload);
      onParsed(res.parsed, res.via);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await run({ base64: btoa(bin), filename: file.name });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-semibold text-forest-900 sm:text-4xl">{t('Drop it ', 'Soltalo ')}<span className="italic text-brand-600">{t('here', 'acá')}</span></h2>
        <p className="mt-2 text-sm text-ink-500">{t('Nothing is saved until you’ve checked what was found.', 'No se guarda nada hasta que revises lo que se encontró.')}</p>
      </div>

      <button
        onClick={() => !busy && fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void onFile(e.dataTransfer.files?.[0]); }}
        disabled={busy}
        className={`dropzone group relative flex w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl px-6 py-14 text-center transition duration-300 ${
          drag ? 'dropzone-over scale-[1.015] bg-lime-300/20' : 'bg-surface hover:bg-brand-50/40'}`}
      >
        {busy ? <ReadingSteps /> : (
          <>
            <div className={`relative transition duration-500 ${drag ? '-translate-y-2 rotate-[-6deg] scale-110' : 'group-hover:-translate-y-1'}`}>
              <span className="float-doc grid h-20 w-16 place-items-center rounded-xl bg-white shadow-xl ring-1 ring-line">
                <span className="space-y-1.5">
                  <span className="block h-1.5 w-8 rounded bg-forest-900" />
                  <span className="block h-1 w-9 rounded bg-line-strong" />
                  <span className="block h-1 w-7 rounded bg-line-strong" />
                  <span className="block h-1 w-8 rounded bg-line-strong" />
                </span>
              </span>
              <span className="absolute -bottom-2 -right-3 grid h-8 w-8 place-items-center rounded-full bg-lime-400 text-sm font-bold text-forest-950 shadow-md">↑</span>
            </div>
            <span className="font-display text-xl font-semibold text-forest-900">{drag ? t('Let go — I’ve got it', 'Soltalo — lo tengo') : t('Drop your CV, or click to choose', 'Soltá tu CV, o hacé clic para elegirlo')}</span>
            <span className="text-xs text-ink-500">
              {t('PDF or Word (.docx)', 'PDF o Word (.docx)')}
            </span>
          </>
        )}
      </button>
      <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />

      {msg && <p className="animate-fade rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">{msg}</p>}

      <KeyBox status={status} onChange={setStatus}
              reason={t('With a free AI key it reads your CV far more accurately.', 'Con una clave gratis de IA lee tu CV con mucha más precisión.')} />

      <details className="text-sm">
        <summary className="cursor-pointer text-ink-500 hover:text-ink-900">{t('Or paste the text of your CV', 'O pegá el texto de tu CV')}</summary>
        <div className="mt-3 space-y-2">
          <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)}
                    className="w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
                    placeholder={t('Open your CV, select all, copy, paste here.', 'Abrí tu CV, seleccioná todo, copiá y pegá acá.')} />
          <Button disabled={busy || !text.trim()} onClick={() => run({ text })}>{busy ? t('Reading…', 'Leyendo…') : t('Read it', 'Leerlo')}</Button>
        </div>
      </details>
    </div>
  );
}

/* ---------------------------------------------------------------- what we found */

function Found({ parsed, via, store, onConfirm, onRetry }: {
  parsed: ParsedCV; via: 'ai' | 'rules'; store: Store; onConfirm: (replace: boolean) => Promise<void>; onRetry: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const hasExisting = store.experience.length > 0;
  const [replace, setReplace] = useState(false);

  const edu = parsed.entries.filter((e) => e.kind === 'education');
  const rest = parsed.entries.filter((e) => e.kind !== 'education');
  const lines = rest.reduce((n, e) => n + e.bullets.length, 0);

  const rows: { label: string; value: string; ok: boolean }[] = [
    { label: t('Name', 'Nombre'), value: parsed.name, ok: Boolean(parsed.name) },
    { label: t('Email', 'Email'), value: parsed.email, ok: Boolean(parsed.email) },
    { label: t('Phone', 'Teléfono'), value: parsed.phone, ok: Boolean(parsed.phone) },
    { label: t('City', 'Ciudad'), value: parsed.location ?? '', ok: Boolean(parsed.location) },
    { label: t('Headline', 'Título'), value: parsed.headline ?? '', ok: Boolean(parsed.headline) },
    { label: t('Education', 'Formación'), value: edu.map((e) => e.org).join(', '), ok: edu.length > 0 },
    { label: t('Experience', 'Experiencia'), value: rest.length ? t(`${rest.length} ${rest.length === 1 ? 'entry' : 'entries'}, ${lines} ${lines === 1 ? 'line' : 'lines'}`,
                               `${rest.length} ${rest.length === 1 ? 'entrada' : 'entradas'}, ${lines} ${lines === 1 ? 'línea' : 'líneas'}`) : '', ok: lines > 0 },
    { label: t('Skills', 'Habilidades'), value: parsed.skills, ok: Boolean(parsed.skills) },
    { label: t('Languages', 'Idiomas'), value: parsed.languages, ok: Boolean(parsed.languages) },
  ];
  const missing = rows.filter((r) => !r.ok).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{t('Here’s what I found', 'Esto es lo que encontré')}</h2>
        <p className="mt-2 text-sm text-ink-500">
          {missing === 0 ? t('Everything a CV needs is here.', 'Está todo lo que necesita un CV.')
            : t(`${missing} thing${missing === 1 ? '' : 's'} missing — you’ll be asked just for ${missing === 1 ? 'that' : 'those'} next.`,
                `Falta${missing === 1 ? '' : 'n'} ${missing} cosa${missing === 1 ? '' : 's'} — a continuación te pregunto sólo eso.`)}
          {via === 'rules' && ' ' + t('(Read with simple rules — a Google key would catch more.)', '(Leído con reglas simples — con una clave de Google encuentra más.)')}
        </p>
      </div>

      <Card className="stagger divide-y divide-line overflow-hidden">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-3 px-4 py-3 text-sm">
            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${r.ok ? 'bg-brand-500 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {r.ok ? '✓' : '!'}
            </span>
            <span className="w-28 shrink-0 text-ink-500">{r.label}</span>
            <span className={`min-w-0 flex-1 break-words ${r.ok ? 'text-ink-900' : 'text-amber-700'}`}>{r.ok ? r.value : t('not found', 'no encontrado')}</span>
          </div>
        ))}
      </Card>

      {rest.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-500 hover:text-ink-900">{t('See every line it read', 'Ver cada línea que leyó')}</summary>
          <div className="mt-3 space-y-3">
            {rest.map((e, i) => (
              <div key={i} className="rounded-xl border border-line bg-surface px-4 py-3">
                <p className="font-medium text-ink-900">{e.org}{e.title && <span className="font-normal text-ink-500"> — {e.title}</span>}</p>
                <ul className="mt-1 space-y-0.5 text-ink-700">{e.bullets.map((b, j) => <li key={j}>• {b}</li>)}</ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {hasExisting && (
        <label className="flex items-start gap-2 rounded-xl bg-sunken px-4 py-3 text-sm text-ink-700">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
          <span>{t('Start fresh from this CV — replace what’s already in Career Lab (otherwise it’s added alongside).',
                   'Empezar de cero con este CV — reemplazar lo que ya hay en Career Lab (si no, se agrega al lado).')}</span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" className="px-6 py-3 text-base" disabled={busy}
                onClick={async () => { setBusy(true); try { await onConfirm(replace); } finally { setBusy(false); } }}>
          {busy ? t('Saving…', 'Guardando…') : t('Looks right — continue →', 'Está bien — continuar →')}
        </Button>
        <Button variant="ghost" onClick={onRetry}>{t('Try another file', 'Probar con otro archivo')}</Button>
      </div>
    </div>
  );
}

