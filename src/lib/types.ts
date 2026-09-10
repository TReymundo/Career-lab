export type Track = 'markets' | 'ib' | 'consulting' | 'product' | 'other';

export const TRACKS: { id: Track; label: string; short: string }[] = [
  { id: 'markets', label: 'Markets — Sales & Trading', short: 'S&T' },
  { id: 'ib', label: 'Investment Banking', short: 'IB' },
  { id: 'consulting', label: 'Consulting / Strategy', short: 'Consulting' },
  { id: 'product', label: 'Product / Corporate Strategy', short: 'Product' },
  { id: 'other', label: 'Other', short: 'Other' },
];

export type Status =
  | 'target' | 'networking' | 'applied' | 'screen'
  | 'interview' | 'final' | 'offer' | 'rejected' | 'withdrawn';

export const STATUSES: { id: Status; label: string; tone: string }[] = [
  { id: 'target', label: 'Target', tone: 'slate' },
  { id: 'networking', label: 'Networking', tone: 'violet' },
  { id: 'applied', label: 'Applied', tone: 'sky' },
  { id: 'screen', label: 'HR screen', tone: 'cyan' },
  { id: 'interview', label: 'Interview', tone: 'amber' },
  { id: 'final', label: 'Final / AC', tone: 'orange' },
  { id: 'offer', label: 'Offer', tone: 'emerald' },
  { id: 'rejected', label: 'Rejected', tone: 'rose' },
  { id: 'withdrawn', label: 'Withdrawn', tone: 'slate' },
];

export const LIVE_STATUSES: Status[] = ['target', 'networking', 'applied', 'screen', 'interview', 'final', 'offer'];

export interface Profile {
  id: number; name: string; headline: string; email: string; phone: string;
  location: string; linkedin: string; summary: string; languages: string; skills: string;
}

export interface Bullet { text: string; tracks: Track[] }

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

export interface Doc {
  id: number; application_id: number | null; kind: 'cv' | 'cover';
  title: string; body: string; created_at: string;
}

export interface Store {
  profile: Profile;
  experience: Experience[];
  application: Application[];
  contact: Contact[];
  event: AppEvent[];
  document: Doc[];
}

export const parseBullets = (raw: string): Bullet[] => {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((b) => b && typeof b.text === 'string')
      .map((b) => ({ text: b.text, tracks: Array.isArray(b.tracks) ? b.tracks : [] })) : [];
  } catch { return []; }
};
