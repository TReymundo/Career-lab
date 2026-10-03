export type Track = 'finance' | 'ib' | 'consulting' | 'data' | 'tech' | 'product' | 'other';

/**
 * Tracks are how the same experience gets aimed at different kinds of employer.
 * Pick the ones you actually apply to; the rest simply never appear.
 */
export const TRACKS: { id: Track; label: string; short: string }[] = [
  { id: 'finance', label: 'Finance, markets & banking', short: 'Finance' },
  { id: 'ib', label: 'Investment banking / M&A', short: 'IB' },
  { id: 'consulting', label: 'Consulting & strategy', short: 'Consulting' },
  { id: 'data', label: 'Data & analytics', short: 'Data' },
  { id: 'tech', label: 'Software & engineering', short: 'Tech' },
  { id: 'product', label: 'Product, marketing & operations', short: 'Product' },
  { id: 'other', label: 'Other', short: 'Other' },
];

export type Status = 'saved' | 'tailored' | 'applied' | 'interviewing' | 'offer' | 'rejected';

/** The board reads left to right; `terminal` columns sit apart from the working flow. */
export const STATUSES: { id: Status; label: string; es: string; tone: string; terminal?: boolean }[] = [
  { id: 'saved', label: 'Saved', es: 'Guardado', tone: 'slate' },
  { id: 'tailored', label: 'Tailored', es: 'Adaptado', tone: 'violet' },
  { id: 'applied', label: 'Applied', es: 'Postulado', tone: 'sky' },
  { id: 'interviewing', label: 'Interviewing', es: 'Entrevistas', tone: 'amber' },
  { id: 'offer', label: 'Offer', es: 'Oferta', tone: 'emerald', terminal: true },
  { id: 'rejected', label: 'Rejected', es: 'Rechazado', tone: 'rose', terminal: true },
];

export const LIVE_STATUSES: Status[] = ['saved', 'tailored', 'applied', 'interviewing', 'offer'];
export const statusMeta = (id: string) => STATUSES.find((s) => s.id === id) ?? STATUSES[0];

export type Lang = 'en' | 'es';

export interface Profile {
  id: number; name: string; headline: string; email: string; phone: string;
  location: string; linkedin: string; summary: string; languages: string; skills: string;
  headline_es: string; summary_es: string; skills_es: string; languages_es: string;
}

/** `es` is the Spanish rendering of the same bullet; empty means "not translated yet". */
export interface Bullet { text: string; es?: string; tracks: Track[] }

export interface Job {
  id: number; source: string; external_id: string; company: string; title: string;
  location: string; url: string; posted_on: string; description: string; track: string;
  category: string; tailored_at: string;
  country: string; city: string; remote: number; level: string; lang: string;
  relevance: number; fit: '' | 'great' | 'good' | 'stretch' | 'no'; fit_why: string; fit_gap: string;
  starred: number; dismissed: number; application_id: number | null; imported_at: string;
}

export interface SavedSearch {
  id: number; name: string; terms: string; exclude: string; created_at: string;
}

export interface Experience {
  id: number; kind: 'work' | 'education' | 'extra'; org: string; title: string;
  location: string; start_date: string; end_date: string; bullets: string; sort_order: number;
}

export interface Application {
  id: number; company: string; role: string; track: Track; location: string;
  status: Status; priority: number; source: string; url: string; deadline: string;
  applied_on: string; next_action: string; next_action_on: string; jd: string;
  notes: string; created_at: string;
}

export interface Contact {
  id: number; application_id: number | null; name: string; company: string; role: string;
  email: string; linkedin: string; how_met: string; last_touch: string; next_touch: string; notes: string;
}

export interface AppEvent {
  id: number; application_id: number; on_date: string; kind: string; note: string;
}

export type DocKind = 'cv' | 'cover' | 'outreach' | 'prep' | 'plan' | 'debrief';

export interface Doc {
  id: number; application_id: number | null; kind: DocKind;
  title: string; body: string; created_at: string;
}

export interface Answer {
  id: number; slug: string; question: string; body: string; body_es: string;
  word_limit: number; company: string; track: string; times_used: number; updated_at: string;
}

export interface ParsedEntry {
  kind: 'work' | 'education' | 'extra';
  org: string; title: string; start_date: string; end_date: string; bullets: string[];
}

export interface ParsedCV {
  name: string; headline?: string; location?: string; email: string; phone: string; linkedin: string; summary: string;
  skills: string; languages: string; entries: ParsedEntry[]; unmatched: string[];
}

export interface Store {
  profile: Profile;
  experience: Experience[];
  application: Application[];
  contact: Contact[];
  event: AppEvent[];
  document: Doc[];
  saved_search: SavedSearch[];
  answer: Answer[];
  story: Story[];
  story_answer: StoryAnswer[];
  setting: Record<string, string>;
}

/** What the "get to know you" interview learned. Private ones inform, but never appear in a document. */
export interface Story {
  id: number; kind: 'story' | 'fact' | 'value' | 'trait'; title: string; body: string; shows: string;
  private: number; answer_id: number | null; created_at: string;
}
export interface StoryAnswer { id: number; question: string; theme: string; created_at: string }

export const parseBullets = (raw: string): Bullet[] => {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((b) => b && typeof b.text === 'string')
      .map((b) => ({ text: b.text, es: typeof b.es === 'string' ? b.es : '', tracks: Array.isArray(b.tracks) ? b.tracks : [] })) : [];
  } catch { return []; }
};
