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

/** Swaps in the tailored profile paragraph, adding the section if the CV has none. */
function withSummary(base: string, summary: string, lang: Lang): string {
  if (!summary) return base;
  const marker = `## ${lang === 'es' ? 'Perfil' : 'Profile'}`;
  const at = base.indexOf(marker);

  if (at < 0) {
    // Insert straight after the contact block, which is the first blank-line-separated chunk.
    const parts = base.split('\n\n');
    return [parts[0], `${marker}\n\n${summary}`, ...parts.slice(1)].join('\n\n');
  }

  const nextHeading = base.indexOf('\n## ', at + marker.length);
  const tail = nextHeading < 0 ? '' : base.slice(nextHeading);
  return `${base.slice(0, at)}${marker}\n\n${summary}\n${tail}`;
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

  const markdown = withSummary(base, adaptation.summary?.trim() ?? '', lang);

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
