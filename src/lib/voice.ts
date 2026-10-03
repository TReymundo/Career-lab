import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice, using what the browser already has — free, no key, nothing to install.
 *
 *   Listening: the Web Speech API (Chrome and Edge). It sends audio to the browser maker's
 *   speech service to turn it into text, then the text is all the app keeps.
 *   Speaking:  speechSynthesis, which uses the voices installed on the computer.
 *
 * Where a browser lacks either, the buttons simply do not appear.
 */

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};

const Recognition = (): (new () => Rec) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canListen = () => typeof window !== 'undefined' && Recognition() !== null;
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * Dictation: press to talk, press again (or pause) to stop. `text` grows as you speak, with
 * the words still being recognised shown separately so they can be drawn lighter.
 */
export function useDictation(lang: 'en' | 'es', onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const rec = useRef<Rec | null>(null);
  const finalCb = useRef(onFinal);
  finalCb.current = onFinal;

  const stop = useCallback(() => { rec.current?.stop(); }, []);
  const start = useCallback(() => {
    const R = Recognition();
    if (!R) { setError('unsupported'); return; }
    const r = new R();
    r.lang = lang === 'es' ? 'es-AR' : 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalCb.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onend = () => { setListening(false); setInterim(''); };
    r.onerror = (e) => { setError(e.error); setListening(false); };
    rec.current = r;
    setError('');
    setListening(true);
    r.start();
  }, [lang]);

  useEffect(() => () => rec.current?.abort(), []);
  return { listening, interim, error, start, stop, supported: canListen() };
}

/** Says a line out loud in the app's language, with the most natural local voice available. */
export function speak(text: string, lang: 'en' | 'es', onEnd?: () => void) {
  if (!canSpeak() || !text.trim()) { onEnd?.(); return; }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const want = lang === 'es' ? ['es-AR', 'es-419', 'es-US', 'es-MX', 'es-ES', 'es'] : ['en-US', 'en-GB', 'en'];
  const voices = synth.getVoices();
  const pick = want.map((code) => voices.filter((v) => v.lang.startsWith(code))).find((list) => list.length);
  // Prefer the "natural"/online voices some systems ship — they sound far less robotic.
  u.voice = pick?.find((v) => /natural|neural|online|google/i.test(v.name)) ?? pick?.[0] ?? null;
  u.lang = u.voice?.lang ?? (lang === 'es' ? 'es-AR' : 'en-US');
  u.rate = 1.02;
  u.onend = () => onEnd?.();
  synth.speak(u);
}

let clip: HTMLAudioElement | null = null;

export const stopSpeaking = () => {
  if (canSpeak()) window.speechSynthesis.cancel();
  if (clip) { clip.pause(); clip = null; }
};

/**
 * A recorded line if one exists (e.g. made with ElevenLabs), the browser's voice otherwise.
 * Drop files in public/voice/<lang>/<id>.mp3 — see public/voice/README.txt — and they are used
 * automatically; a missing file falls back without a sound out of place.
 */
export function say(id: string, text: string, lang: 'en' | 'es', onEnd?: () => void) {
  stopSpeaking();
  const audio = new Audio(`/voice/${lang}/${id}.mp3`);
  clip = audio;
  let fellBack = false;
  const fallback = () => { if (fellBack || clip !== audio) return; fellBack = true; clip = null; speak(text, lang, onEnd); };
  audio.onended = () => { if (clip === audio) clip = null; onEnd?.(); };
  audio.onerror = fallback;
  audio.play().catch(fallback);
}
