import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from '../components/ui.tsx';
import Tabs from '../components/Tabs.tsx';
import { api, type StoryStatus } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import { QUESTIONS, REACTIONS, answeredIds, type Q } from '../lib/interview.ts';
import { canSpeak, say, stopSpeaking, useDictation } from '../lib/voice.ts';
import type { Story, Store } from '../lib/types.ts';

/**
 * "Get to know you": a friend asking questions, not a form.
 *
 * Eight questions a session, each with at most one follow-up. You type or talk; it answers out
 * loud if you want. Everything it learns lands in your story bank on the right — the raw
 * material cover letters and tailored CVs are written from.
 */

interface Msg { from: 'ai' | 'me'; text: string; hint?: string }

const VOICE_KEY = 'career-lab-voice';

export default function StoryPage({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const lang = useUILang();
  const done = useMemo(() => answeredIds(store.story_answer.map((a) => a.question)), [store.story_answer]);
  const open = QUESTIONS.filter((q) => !done.has(q.id));
  const total = QUESTIONS.length;

  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<Q | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [talking, setTalking] = useState(false);
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem(VOICE_KEY) === '1'; } catch { return false; } });
  const [finished, setFinished] = useState(false);
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const dictation = useDictation(lang, (text) => setDraft((d) => `${d}${d && !d.endsWith(' ') ? ' ' : ''}${text}`));

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => { try { localStorage.setItem(VOICE_KEY, voice ? '1' : '0'); } catch { /* private window */ } }, [voice]);

  /** The friend speaks: shown in the chat, and said out loud (a recorded clip if there is one). */
  const speakLine = (id: string, text: string) => {
    setMsgs((m) => [...m, { from: 'ai', text }]);
    if (voice) { setTalking(true); say(id, text, lang, () => setTalking(false)); }
  };
  const ask = (q: Q, lead = '') => {
    setCurrent(q);
    setMsgs((m) => [...m, ...(lead ? [{ from: 'ai' as const, text: lead }] : []), { from: 'ai' as const, text: q[lang], hint: q.hints[lang] }]);
    if (voice) { setTalking(true); say(q.id, `${lead ? `${lead} ` : ''}${q[lang]}`, lang, () => setTalking(false)); }
  };

  const begin = () => {
    if (!open.length) { setFinished(true); return; }
    setRunning(true); setFinished(false); setMsgs([]);
    ask(open[0], done.size === 0
      ? t('Hey! Ten questions, all wide open. Talk or type as much as you want — the more you tell me, the better every letter gets.', '¡Hola! Diez preguntas, todas abiertas. Hablá o escribí todo lo que quieras — cuanto más me cuentes, mejor sale cada carta.')
      : t('Welcome back! Let’s pick up where we left off.', '¡Volviste! Sigamos donde quedamos.'));
  };

  const send = async () => {
    const answer = draft.trim();
    if (!answer || !current) return;
    if (dictation.listening) dictation.stop();
    stopSpeaking();
    setSending(true);
    setMsgs((m) => [...m, { from: 'me', text: answer }]);
    setDraft('');
    // Saved instantly; the AI turns it into stories in the background.
    await api.storyAnswer({ question: current[lang], answer, theme: current.theme, lang }).catch(() => {});
    await reload();
    setSending(false);
    const pool = REACTIONS[answer.length > 220 ? 'long' : 'short'][lang];
    const reaction = pool[Math.floor(Math.random() * pool.length)];
    const next = QUESTIONS.filter((q) => q.id !== current.id && !done.has(q.id))[0];
    if (next) ask(next, reaction);
    else {
      setCurrent(null);
      setRunning(false);
      setFinished(true);
      speakLine('done', `${reaction} ${t('That’s all ten — thank you. I’m turning your answers into stories now.', 'Esas son las diez — gracias. Ahora estoy convirtiendo tus respuestas en historias.')}`);
    }
  };

  const skip = () => {
    if (!current) return;
    stopSpeaking(); if (dictation.listening) dictation.stop(); setDraft('');
    const rest = QUESTIONS.filter((q) => !done.has(q.id));
    const i = rest.findIndex((q) => q.id === current.id);
    const next = rest[i + 1];
    if (next) ask(next); else { setRunning(false); setCurrent(null); }
  };

  const position = current ? QUESTIONS.findIndex((q) => q.id === current.id) + 1 : 0;

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
      <Card className="relative overflow-hidden">
        {!running && (
          <div className="relative px-6 py-12 text-center sm:px-12">
            <Orb state={talking ? 'talk' : 'idle'} big />
            <h2 className="mt-6 text-3xl font-semibold text-forest-900">
              {finished || !open.length ? t('Nice talking to you', 'Qué bueno charlar con vos')
                : done.size === 0 ? t('Let’s get to know you', 'Conozcámonos') : t('Pick up where we left off', 'Sigamos donde quedamos')}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-ink-500">
              {finished || !open.length
                ? t('Your answers are in. They become stories in your bank — cover letters and tailored CVs are written from them.', 'Tus respuestas ya están. Se convierten en historias en tu banco — las cartas y los CVs a medida salen de ahí.')
                : t('Ten open questions, like a chat with a friend. Talk or type as long as you want — one long answer is worth more than ten short ones.',
                    'Diez preguntas abiertas, como una charla con un amigo. Hablá o escribí todo lo que quieras — una respuesta larga vale más que diez cortas.')}
            </p>
            <div className="mx-auto mt-6 flex max-w-xs justify-center gap-1.5">
              {QUESTIONS.map((q) => <span key={q.id} className={`h-2 flex-1 rounded-full transition-all duration-500 ${done.has(q.id) ? 'bg-lime-500' : 'bg-sunken'}`} />)}
            </div>
            <p className="mt-2 text-xs text-ink-400">{t(`${done.size} of ${total} answered`, `${done.size} de ${total} respondidas`)}</p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              {open.length > 0 && (
                <Button variant="primary" className="px-7 py-3 text-base" onClick={begin}>{done.size === 0 ? t('Start the chat', 'Empezar la charla') : t('Continue', 'Seguir')}</Button>
              )}
              {canSpeak() && <VoiceToggle on={voice} set={setVoice} />}
            </div>
            {(finished || !open.length) && <Link to="/cv" className="mt-5 inline-block text-sm text-brand-700 hover:underline">{t('← Back to your CV', '← Volver a tu CV')}</Link>}
          </div>
        )}

        {running && (
          <div className="flex h-[min(76vh,760px)] flex-col">
            <div className="flex items-center gap-3 border-b border-line px-5 py-3">
              <Orb state={talking ? 'talk' : dictation.listening ? 'listen' : 'idle'} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">{t('Getting to know you', 'Conociéndote')}</p>
                <div className="mt-1 flex gap-1">
                  {QUESTIONS.map((q) => <span key={q.id} className={`h-1 flex-1 rounded-full transition-all duration-500 ${done.has(q.id) ? 'bg-lime-500' : q.id === current?.id ? 'bg-brand-300' : 'bg-sunken'}`} />)}
                </div>
              </div>
              <span className="text-xs tabular-nums text-ink-400">{position}/{total}</span>
              {canSpeak() && <VoiceToggle on={voice} set={(v) => { setVoice(v); if (!v) stopSpeaking(); }} small />}
              <button onClick={() => { stopSpeaking(); setRunning(false); }} className="text-xs text-ink-400 hover:text-ink-900">{t('Pause', 'Pausar')}</button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
              {msgs.map((m, i) => (
                m.from === 'ai'
                  ? (
                    <div key={i} className="page-up flex gap-3">
                      <span className="orb mt-1 h-7 w-7 shrink-0 rounded-full" />
                      <div className="max-w-[88%]">
                        <p className="rounded-2xl rounded-tl-md bg-sunken px-4 py-2.5 text-[15px] leading-relaxed text-ink-900">{m.text}</p>
                        {m.hint && <p className="mt-1.5 px-1 text-xs leading-relaxed text-ink-400">💡 {m.hint}</p>}
                      </div>
                    </div>
                  )
                  : (
                    <div key={i} className="page-up flex justify-end">
                      <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-tr-md bg-forest-900 px-4 py-2.5 text-[15px] leading-relaxed text-white">{m.text}</p>
                    </div>
                  )
              ))}
              <div ref={end} />
            </div>

            <div className="border-t border-line p-4">
              <div className={`flex items-end gap-2 rounded-2xl border bg-surface p-2 transition ${dictation.listening ? 'border-rose-300 ring-4 ring-rose-100' : 'border-line focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-100'}`}>
                <textarea rows={4} value={draft + (dictation.interim ? `${draft ? ' ' : ''}${dictation.interim}` : '')}
                          onChange={(e) => setDraft(e.target.value)} disabled={sending}
                          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}
                          placeholder={dictation.listening ? t('Listening… take your time, talk as long as you want', 'Escuchando… tomate tu tiempo, hablá todo lo que quieras') : t('Type your answer — or press the mic and just talk', 'Escribí tu respuesta — o tocá el micrófono y hablá')}
                          className="min-h-[96px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-ink-400" />
                <div className="flex flex-col gap-2">
                  {dictation.supported && (
                    <button onClick={() => (dictation.listening ? dictation.stop() : (stopSpeaking(), dictation.start()))}
                            title={dictation.listening ? t('Stop', 'Parar') : t('Talk', 'Hablar')}
                            className={`relative grid h-12 w-12 place-items-center rounded-full text-lg transition ${dictation.listening ? 'bg-rose-500 text-white' : 'bg-lime-400 text-forest-950 hover:bg-lime-300'}`}>
                      {dictation.listening && <span className="absolute inset-0 animate-ping rounded-full bg-rose-400/50" />}
                      <span className="relative">🎙</span>
                    </button>
                  )}
                  <button onClick={() => void send()} disabled={sending || !draft.trim()}
                          className="grid h-12 w-12 place-items-center rounded-full bg-forest-900 text-lime-300 transition hover:bg-forest-800 disabled:opacity-30">➤</button>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-ink-400">
                <span>{dictation.error && dictation.error !== 'no-speech' ? t('The mic is not available here — try Chrome or Edge, and allow the microphone.', 'El micrófono no está disponible acá — probá Chrome o Edge, y permití el micrófono.') : t('Ctrl+Enter to send', 'Ctrl+Enter para enviar')}</span>
                <button onClick={skip} disabled={sending} className="hover:text-ink-900">{t('Skip this one →', 'Saltear esta →')}</button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <StoryBank store={store} reload={reload} />
    </div>
  );
}

/** The friend: an orb that breathes, ripples while it talks, and glows red while it listens. */
function Orb({ state, big = false }: { state: 'idle' | 'talk' | 'listen' | 'think'; big?: boolean }) {
  const size = big ? 'h-24 w-24' : 'h-10 w-10';
  return (
    <span className={`relative mx-auto block shrink-0 ${size}`}>
      {(state === 'talk' || state === 'listen') && (
        <span className={`absolute inset-0 animate-ping rounded-full ${state === 'listen' ? 'bg-rose-400/40' : 'bg-lime-400/50'}`} />
      )}
      <span className={`orb absolute inset-0 rounded-full ${state === 'think' ? 'orb-think' : ''} ${state === 'listen' ? 'orb-listen' : ''}`} />
    </span>
  );
}

function VoiceToggle({ on, set, small = false }: { on: boolean; set: (v: boolean) => void; small?: boolean }) {
  const t = useT();
  return (
    <button onClick={() => set(!on)}
            className={`flex items-center gap-1.5 rounded-full border transition ${small ? 'px-2.5 py-1 text-xs' : 'px-4 py-2.5 text-sm'} ${on ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-line text-ink-500 hover:border-line-strong'}`}>
      {on ? '🔊' : '🔈'} {on ? t('Voice on', 'Voz activada') : t('Read questions aloud', 'Leer en voz alta')}
    </button>
  );
}

/* ---------------------------------------------------------------- the bank */

function StoryBank({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const lang = useUILang();
  const [tab, setTab] = useState<'story' | 'fact' | 'more'>('story');
  const [status, setStatus] = useState<StoryStatus | null>(null);

  // While answers are waiting to become stories, check in every few seconds and refresh the bank as they land.
  const answered = store.story_answer.length;
  useEffect(() => {
    let alive = true;
    let last = -1;
    const tick = async () => {
      const s = await api.storyStatus().catch(() => null);
      if (!alive || !s) return;
      setStatus(s);
      if (last !== -1 && s.pending < last) void reload();
      last = s.pending;
    };
    void tick();
    const id = setInterval(() => void tick(), 4000);
    return () => { alive = false; clearInterval(id); };
  }, [answered]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = store.story.filter((s) => (tab === 'more' ? s.kind === 'value' || s.kind === 'trait' : s.kind === tab));
  const count = (k: Story['kind'][]) => store.story.filter((s) => k.includes(s.kind)).length;

  return (
    <Card className="p-5 xl:sticky xl:top-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-600">{t('Your story bank', 'Tu banco de historias')}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-forest-900">{store.story.length} <span className="text-base font-normal text-ink-400">{t('things it knows', 'cosas que sabe')}</span></p>
      {status && status.pending > 0 && (
        <div className={`animate-fade mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs ${status.retryIn ? 'bg-amber-50 text-amber-800' : 'bg-lime-300/40 text-forest-900'}`}>
          {status.retryIn ? <span>⏳</span> : <span className="orb orb-think h-4 w-4 shrink-0 rounded-full" />}
          <span className="flex-1">
            {status.retryIn
              ? t(`The free AI is resting. ${status.pending} answers wait safely — retrying in ${status.retryIn > 90 ? `${Math.ceil(status.retryIn / 60)} min` : `${status.retryIn}s`}.`,
                  `La IA gratis está descansando. ${status.pending} respuestas esperan a salvo — reintento en ${status.retryIn > 90 ? `${Math.ceil(status.retryIn / 60)} min` : `${status.retryIn}s`}.`)
              : t(`Turning ${status.pending} answers into stories…`, `Convirtiendo ${status.pending} respuestas en historias…`)}
          </span>
          {status.retryIn > 0 && <button onClick={async () => setStatus(await api.storyProcess(lang))} className="font-semibold underline">{t('Try now', 'Probar ya')}</button>}
        </div>
      )}
      <div className="mt-3">
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: 'story', label: t('Stories', 'Historias'), count: count(['story']) },
          { key: 'fact', label: t('Facts', 'Datos'), count: count(['fact']) },
          { key: 'more', label: t('You', 'Vos'), count: count(['value', 'trait']) },
        ]} />
      </div>
      <div className="stagger mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
        {items.length === 0 && <p className="py-6 text-center text-sm text-ink-400">{t('Nothing yet — it fills up as you talk.', 'Nada todavía — se llena mientras charlamos.')}</p>}
        {items.map((s) => (
          <div key={s.id} className="group rounded-xl border border-line bg-surface p-3">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium text-ink-900">{s.title}</p>
              <button onClick={async () => { await api.update('story', s.id, { private: s.private ? 0 : 1 }); await reload(); }}
                      title={s.private ? t('Private: never used in documents. Click to allow.', 'Privado: nunca se usa en documentos. Clic para permitir.') : t('Usable in documents. Click to make private.', 'Se puede usar en documentos. Clic para hacerlo privado.')}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition ${s.private ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-700'}`}>
                {s.private ? `🔒 ${t('private', 'privado')}` : t('usable', 'usable')}
              </button>
              <button onClick={async () => { await api.remove('story', s.id); await reload(); }} className="shrink-0 text-xs text-ink-300 opacity-0 transition hover:text-rose-600 group-hover:opacity-100">✕</button>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">{s.body}</p>
            {s.shows && <p className="mt-1.5 text-[11px] text-brand-700">{t('Shows', 'Muestra')}: {s.shows}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}
