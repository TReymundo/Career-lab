import { useSyncExternalStore } from 'react';

/**
 * The whole app speaks one of two languages, chosen once in the header.
 *
 * There is no key registry: `t('English text', 'Texto en español')` returns the right one.
 * Keys are a maintenance tax that pays off across dozens of locales; with two, the text
 * sitting where it is used is easier to read and impossible to leave stale.
 */
export type UILang = 'en' | 'es';

const STORAGE_KEY = 'career-lab-lang';

function initial(): UILang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
    return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
  } catch {
    return 'en';
  }
}

let current: UILang = initial();
const listeners = new Set<() => void>();

export function setUILang(lang: UILang) {
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* private window; the choice just won't persist */ }
  try { document.documentElement.lang = lang; } catch { /* not in a document */ }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useUILang(): UILang {
  return useSyncExternalStore(subscribe, () => current, () => 'en');
}

/** `const t = useT(); t('Save', 'Guardar')` */
export function useT() {
  const lang = useUILang();
  return (en: string, es: string) => (lang === 'es' ? es : en);
}

/** For code outside React (formatters, generators) that needs the current choice. */
export const getUILang = () => current;
