import { useCallback, useEffect, useState } from 'react';
import type { Job, ParsedCV, Store } from './types.ts';

const json = async (res: Response) => {
  if (!res.ok) {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body) as { error?: string };
      throw new Error(parsed.error || `${res.status} ${body}`);
    } catch (e) {
      if (e instanceof Error && e.message && !e.message.startsWith('Unexpected')) throw e;
      throw new Error(`${res.status} ${body}`);
    }
  }
  return res.json();
};

export const api = {
  all: (): Promise<Store> => fetch('/api/all').then(json),
  create: <T,>(table: string, body: Partial<T>): Promise<T> =>
    fetch(`/api/${table}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  update: <T,>(table: string, id: number, body: Partial<T>): Promise<T> =>
    fetch(`/api/${table}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  remove: (table: string, id: number) => fetch(`/api/${table}/${id}`, { method: 'DELETE' }).then(json),
  saveProfile: (body: Record<string, string>) =>
    fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),

  searchJobs: (params: { q?: string; starred?: boolean; dismissed?: boolean; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.starred) qs.set('starred', '1');
    if (params.dismissed) qs.set('dismissed', '1');
    qs.set('limit', String(params.limit ?? 200));
    qs.set('offset', String(params.offset ?? 0));
    return fetch(`/api/jobs/search?${qs}`).then(json) as Promise<{ total: number; rows: Job[] }>;
  },

  importJobs: (text: string, mode: 'table' | 'blocks', source?: string) =>
    post('/api/jobs/import', { text, mode, source }) as Promise<{ inserted: number; skipped: number; mapped?: Record<string, string> }>,

  fetchAts: (provider: string, slug: string) =>
    post('/api/jobs/ats', { provider, slug }) as Promise<{ inserted: number; skipped: number; provider?: string; slug?: string }>,

  importLinkedInProfile: (filename: string, text: string) =>
    post('/api/import/linkedin-profile', { filename, text }) as Promise<{ imported: number; into: string }>,

  promote: (jobId: number, track?: string) =>
    post(`/api/jobs/${jobId}/promote`, { track }) as Promise<{ application_id: number; already: boolean }>,

  emailStatus: () => fetch('/api/email/status').then(json) as Promise<{ configured: boolean; user: string; host: string }>,
  emailScan: (days: number) => post('/api/email/scan', { days }) as Promise<{ proposals: EmailProposal[] }>,
  emailApply: (proposals: EmailProposal[]) => post('/api/email/apply', { proposals }),

  aiStatus: () => fetch('/api/ai/status').then(json) as Promise<AiStatus>,
  aiSetKey: (key: string) =>
    fetch('/api/ai/key', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }).then(json) as Promise<AiStatus>,
  aiBullets: (payload: { bullets: string[]; role?: string; track?: string; lang: string }) =>
    post('/api/ai/bullets', payload) as Promise<{ suggestions: BulletSuggestion[] }>,
  aiSummary: (payload: { headline: string; bullets: string[]; track: string; lang: string }) =>
    post('/api/ai/summary', payload) as Promise<{ text: string }>,
  aiReview: (payload: { cv: string; track?: string; jd?: string; lang: string }) =>
    post('/api/ai/review', payload) as Promise<{ review: AiReview }>,
  aiPolish: (payload: { fields: FieldItem[]; track?: string; lang: string }) =>
    post('/api/ai/polish', payload) as Promise<{ edits: FieldEdit[] }>,
  aiSources: (payload: { cv: string; tracks: string; location: string; keywords: string; lang: string }) =>
    post('/api/ai/sources', payload) as Promise<{ plan: SourcePlan }>,
  aiExtractJobs: (payload: { text: string; lang: string }) =>
    post('/api/ai/extract-jobs', payload) as Promise<{ jobs: unknown[]; inserted: number; skipped: number }>,
  aiAdapt: (payload: { cv: string; company: string; role: string; jd: string; lang: string }) =>
    post('/api/ai/adapt', payload) as Promise<{ adaptation: { summary: string; lead: string[]; why: string } }>,

  pullJobs: (queries: string[], feeds?: string[]) =>
    post('/api/jobs/pull', { queries, feeds }) as Promise<PullReport>,
  aiTranslate: (payload: { text: string; to: 'es' | 'en' }) =>
    post('/api/ai/translate', payload) as Promise<{ text: string }>,

  /* --- Finding jobs (Stage 2) --- */
  browseJobs: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return fetch(`/api/jobs/browse?${qs}`).then(json) as Promise<BrowseResult>;
  },
  getKit: (jobId: number) => fetch(`/api/kit/${jobId}`).then(json) as Promise<{ kit: Kit | null }>,
  buildKit: (jobId: number, lang: string, jd?: string) => post(`/api/kit/${jobId}/build`, { lang, jd }) as Promise<{ kit: Kit }>,
  saveKitDecisions: (jobId: number, decisions: KitDecisions) =>
    fetch(`/api/kit/${jobId}/decisions`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decisions }) }).then(json),
  kits: () => fetch('/api/kits').then(json) as Promise<{ kits: { job_id: number; application_id: number | null; created_at: string }[] }>,
  storyAnswer: (body: { question: string; answer: string; theme: string; lang: string }) => post('/api/story/answer', body) as Promise<StoryStatus>,
  cvFromStory: (lang: string) => post('/api/cv/from-story', { lang }) as Promise<{ added: number; filled: string[] }>,
  storyStatus: () => fetch('/api/story/status').then(json) as Promise<StoryStatus>,
  storyReprocess: (lang: string) => post('/api/story/reprocess', { lang }) as Promise<StoryStatus>,
  storyProcess: (lang: string) => post('/api/story/process', { lang }) as Promise<StoryStatus>,
  storyTurn: (body: { question: string; answer: string; theme: string; isFollowUp: boolean; lang: string }) =>
    post('/api/story/turn', body) as Promise<{ reaction: string; followUp: string; items: { id: number; kind: string; title: string; private: boolean }[]; error?: string }>,
  journey: () => fetch('/api/journey').then(json) as Promise<JourneyStatus>,
  aiHealth: () => fetch('/api/ai/health').then(json) as Promise<AiHealth>,
  addAiProvider: (kind: string, key: string) => post('/api/ai/providers', { kind, key }) as Promise<{ ok: boolean; model?: string; error?: string }>,
  testAiProvider: (id: string) => post(`/api/ai/providers/${id}/test`, {}) as Promise<{ ok: boolean; model?: string; error?: string }>,
  removeAiProvider: (id: string) => post(`/api/ai/providers/${id}/remove`, {}),
  aiTitles: (cv: string, lang: string, aim?: { fields: string[]; experience: string }) =>
    post('/api/ai/titles', { cv, lang, ...aim }) as Promise<{ titles: string[] }>,
  scoreJobs: (cv: string) => post('/api/jobs/score', { cv }) as Promise<{ scored: number; remaining: number; wait: number }>,
  fitJobs: (ids: number[], cv: string, lang: string) => post('/api/jobs/fit', { ids, cv, lang }) as Promise<{ judged: number }>,
  sourcesStatus: () => fetch('/api/sources/status').then(json) as Promise<SourcesStatus>,
  connectGmail: (user: string, password: string) => post('/api/sources/gmail', { user, password }) as Promise<{ configured: boolean }>,
  disconnectGmail: () => post('/api/sources/gmail/disconnect', {}),
  setJSearchKey: (key: string) =>
    fetch('/api/sources/jsearch', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }).then(json),
  pullJSearch: (queries: { query: string; country: string; language: string }[]) =>
    post('/api/jobs/jsearch', { queries }) as Promise<{ inserted: number; fetched: number; requests: number; used: number; limit: number; errors: string[] }>,
  pullGetOnBoard: (queries: string[]) => post('/api/jobs/getonbrd', { queries }) as Promise<{ inserted: number; fetched: number; errors: string[] }>,
  setGroqKey: (key: string) => post('/api/sources/groq', { key }) as Promise<{ configured: boolean }>,
  rescopeJobs: () => post('/api/jobs/rescope', {}) as Promise<{ removed: number }>,
  scanAlerts: (days = 60) => post('/api/alerts/scan', { days }) as Promise<{ emails: number; found: number; inserted: number; errors: string[] }>,

  setSetting: (key: string, value: string) =>
    fetch(`/api/setting/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) }).then(json),

  parseCV: (payload: { text?: string; base64?: string; filename?: string }) =>
    post('/api/cv/parse', payload) as Promise<{ parsed: ParsedCV; chars: number; via: 'ai' | 'rules' }>,
  applyCV: (parsed: ParsedCV, replaceExisting: boolean) =>
    post('/api/cv/apply', { parsed, replaceExisting }) as Promise<{ experiences: number }>,

  /** Streams the generated file straight to the browser's downloads. */
  exportFile: async (payload: { markdown: string; format: 'pdf' | 'docx'; kind: string; company?: string; lang: string; name: string }) => {
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const name = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `document.${payload.format}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    return name;
  },
};

export interface BrowseJob extends Job { rank: number; match: number; reasons: string[] }
export interface Facet { v: string | number; n: number }
export interface BrowseResult {
  total: number;
  rows: BrowseJob[];
  facets: { country: Facet[]; city: Facet[]; level: Facet[]; lang: Facet[]; source: Facet[]; remote: Facet[] };
  counts: { total: number; unscored: number; saved: number; dismissed: number };
  views: { foryou: number; new: number; all: number };
}
export interface SourcesStatus {
  gmail: { configured: boolean; user: string; last: string };
  jsearch: { configured: boolean; used: number; limit: number };
  ai: boolean;
  groq: boolean;
}
export interface StoryStatus { pending: number; working: boolean; lastError: string; retryIn: number }

export interface Kit {
  job_id: number; application_id: number | null; jd: string; created_at: string;
  data: {
    requirements: { text: string; covered: 'yes' | 'partly' | 'no'; evidence: string }[];
    headline: string; summary: string;
    edits: { target: string; to: string; why: string }[];
    order: number[]; drop: number[]; skills: string;
    gaps: { requirement: string; question: string }[];
    why: string; letter: string; lang: 'en' | 'es'; hasPosting: boolean; builtAt: string;
  };
  decisions: KitDecisions;
}
/** What you rejected (everything is accepted by default) and your edited letter. */
export interface KitDecisions { rejected?: string[]; letter?: string }

export interface JourneyStatus {
  jobs: { total: number; foryou: number; saved: number };
  apply: { tailored: number; saved: number };
  track: { applied: number; interviewing: number };
}
export interface AiHealth {
  providers: { id: string; kind: string; name: string; hint: string }[];
  routes: { id: string; provider: string; label: string; ok: number; resting: number; until: string; ready: boolean; lastError: string }[];
}
export interface AiStatus { configured: boolean; source: 'env' | 'app' | 'none'; model: string; hint: string }
export interface BulletSuggestion { original: string; improved: string; why: string; needs: string[] }
export interface FieldItem { target: string; label: string; value: string }
export interface PullReport {
  inserted: number;
  skipped: number;
  fetched: number;
  perFeed: { feed: string; fetched: number; error?: string }[];
}

export interface SourcePlan {
  queries: { label: string; keywords: string; location: string }[];
  companies: { name: string; slug: string; why: string; board?: boolean }[];
  titles: string[];
}
export interface FieldEdit { target: string; label: string; from: string; to: string; why: string }
export interface AiReview {
  verdict: string;
  strengths: string[];
  fixes: { problem: string; fix: string; where: string }[];
  missing: string[];
}

export interface EmailProposal {
  application_id: number; company: string; role: string; from: string; subject: string;
  date: string; current: string; proposed: string; matched: string; confidence: 'high' | 'medium';
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json);

/** One store for the whole app: reload after every mutation keeps state honest without a client cache. */
export function useStore() {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try { setStore(await api.all()); setError(null); }
    catch (e) { setError(String(e)); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { store, error, reload };
}

export const today = () => new Date().toISOString().slice(0, 10);

export const daysUntil = (iso: string) => {
  if (!iso) return null;
  const d = Date.parse(`${iso}T00:00:00`);
  if (Number.isNaN(d)) return null;
  return Math.round((d - Date.parse(`${today()}T00:00:00`)) / 86_400_000);
};

export const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};
