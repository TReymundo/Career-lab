import { api, today } from './api.ts';
import { buildCV } from './templates.ts';
import type { Doc, Job, Lang, Store, Track } from './types.ts';

/**
 * Turning one posting into a CV written for it.
 *
 * Shared between the job list and the dashboard so that generating one and generating fifty
 * are the same operation, and a fix to either is a fix to both.
 */
export interface AdaptResult {
  applicationId: number;
  documentId: number;
  markdown: string;
  why: string;
  company: string;
  title: string;
}

/**
 * Swaps in the tailored profile paragraph. It lives in the header block as an italic `> `
 * line (see buildCV); if the CV has none yet, it goes at the end of that block.
 */
function withSummary(base: string, summary: string): string {
  if (!summary) return base;
  const line = `> ${summary.replace(/\s+/g, ' ').trim()}`;
  const [head, ...rest] = base.split('\n\n');
  const lines = head.split('\n');
  const at = lines.findIndex((l) => l.startsWith('> '));
  if (at >= 0) lines[at] = line; else lines.push(line);
  return [lines.join('\n'), ...rest].join('\n\n');
}

export async function adaptJob({ job, store, track, lang }: {
  job: Job; store: Store; track: Track; lang: Lang;
}): Promise<AdaptResult> {
  const base = buildCV(store.profile, store.experience, { track, lang, template: 'ats' });

  // The model runs first. If it fails, nothing has been written — no half-made application
  // left sitting in the pipeline with no CV attached to it.
  const { adaptation } = await api.aiAdapt({
    cv: base, company: job.company, role: job.title, jd: job.description, lang,
  });

  const markdown = withSummary(base, adaptation.summary?.trim() ?? '');

  const { application_id } = await api.promote(job.id, track);
  const doc = await api.create<Doc>('document', {
    application_id,
    kind: 'cv',
    title: `CV — ${job.company} — ${job.title}`.slice(0, 120),
    body: markdown,
  });

  await api.update('application', application_id, { status: 'tailored', jd: job.description });
  await api.update('job', job.id, { tailored_at: today() });

  return {
    applicationId: application_id,
    documentId: doc.id,
    markdown,
    why: adaptation.why ?? '',
    company: job.company,
    title: job.title,
  };
}
