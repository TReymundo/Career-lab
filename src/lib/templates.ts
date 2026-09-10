import type { Application, Experience, Profile, Track } from './types.ts';
import { parseBullets } from './types.ts';

const line = (s: string) => s.trim();

/** Bullets with no track tags are universal; tagged ones only surface for their track. */
export function bulletsFor(exp: Experience, track: Track) {
  return parseBullets(exp.bullets).filter((b) => b.tracks.length === 0 || b.tracks.includes(track));
}

export function buildCV(profile: Profile, experience: Experience[], track: Track, maxBullets = 4): string {
  const head = [
    `# ${profile.name || 'Your Name'}`,
    line([profile.headline, profile.location].filter(Boolean).join(' · ')),
    line([profile.email, profile.phone, profile.linkedin].filter(Boolean).join(' · ')),
  ].filter(Boolean).join('\n');

  const section = (label: string, kind: Experience['kind']) => {
    const rows = experience.filter((e) => e.kind === kind);
    if (!rows.length) return '';
    const body = rows.map((e) => {
      const dates = [e.start_date, e.end_date || 'Present'].filter(Boolean).join(' – ');
      const header = `**${e.org}**${e.title ? ` — ${e.title}` : ''}${e.location ? `, ${e.location}` : ''}${dates ? `  \n*${dates}*` : ''}`;
      const bs = bulletsFor(e, track).slice(0, maxBullets).map((b) => `- ${b.text}`).join('\n');
      return [header, bs].filter(Boolean).join('\n');
    }).join('\n\n');
    return `## ${label}\n\n${body}`;
  };

  return [
    head,
    profile.summary ? `## Profile\n\n${profile.summary}` : '',
    section('Experience', 'work'),
    section('Education', 'education'),
    section('Leadership & Extracurricular', 'extra'),
    profile.skills ? `## Skills\n\n${profile.skills}` : '',
    profile.languages ? `## Languages\n\n${profile.languages}` : '',
  ].filter(Boolean).join('\n\n');
}

interface CoverInput {
  profile: Profile;
  app: Application;
  hook: string;       // why this desk / firm, in your words
  proof: string;      // the single strongest concrete story
  contact: string;    // name of the person you spoke to, if any
}

const TRACK_PITCH: Record<Track, { why: string; close: string }> = {
  markets: {
    why: 'I want to be on a trading floor because the feedback loop is immediate and the work is decided in real time — the opposite of the monthly reporting cycle I know well enough to want to leave behind.',
    close: 'I would welcome the chance to spend fifteen minutes on the phone talking about the desk and where a graduate can add value from day one.',
  },
  ib: {
    why: 'Banking appeals to me because the analysis actually decides something — a price, a structure, a deal that either clears or does not — and I want to build that judgement early, alongside people who do it at scale.',
    close: 'I would be grateful for a short conversation about the group and what the strongest analysts in your class did in their first year.',
  },
  consulting: {
    why: 'Consulting attracts me because the problem changes every few months and the standard of structured thinking is set by the people around you. My degree at ITBA has been exactly that exercise, and I want to do it against real client stakes.',
    close: 'I would appreciate a short conversation about the office and the kind of cases a joiner from a finance background tends to be staffed on.',
  },
  product: {
    why: 'I want to sit closer to the decision than reporting allows — where the data I already produce becomes the argument for what the business should actually do next.',
    close: 'I would welcome a short conversation about the team and the problems it is prioritising this year.',
  },
  other: {
    why: 'I am looking for a role where the analysis I do changes a decision rather than describing one after the fact.',
    close: 'I would welcome a short conversation about the team and the role.',
  },
};

export function buildCover({ profile, app, hook, proof, contact }: CoverInput): string {
  const t = TRACK_PITCH[app.track] ?? TRACK_PITCH.other;
  const company = app.company || '[Company]';
  const role = app.role || '[Role]';
  const intro = contact
    ? `I am writing to apply for the ${role} position at ${company}, following my conversation with ${contact}.`
    : `I am writing to apply for the ${role} position at ${company}.`;

  return [
    `${profile.name}`,
    [profile.email, profile.phone, profile.linkedin].filter(Boolean).join(' · '),
    '',
    `${company} — ${role}`,
    '',
    'Dear Hiring Team,',
    '',
    `${intro} ${hook || `[One specific, non-generic reason you want ${company} in particular — a desk, a deal, a person, a product.]`}`,
    '',
    t.why,
    '',
    proof || '[Your strongest concrete story: the situation, what you personally did, and the number or outcome that resulted. One paragraph, no adjectives you cannot defend.]',
    '',
    `${profile.summary || '[Two lines on what you bring: the technical base, the languages, the degree finishing this year.]'}`,
    '',
    t.close,
    '',
    'Kind regards,',
    profile.name || '[Your name]',
  ].join('\n');
}

const STOP = new Set(('a an and are as at be by for from has have in is it its of on or that the to with will you your we our their they '
  + 'this these those who whom which what when where how role team work working experience candidate candidates ability able strong excellent '
  + 'good great new all any more most other such using use used within across including include includes must should may can').split(' '));

/** Rough JD-vs-CV keyword gap: what the posting leans on that your document never says. */
export function keywordGap(jd: string, cv: string, limit = 14): { word: string; count: number }[] {
  if (!jd.trim()) return [];
  const cvWords = new Set(cv.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ+#.]{2,}/g) ?? []);
  const counts = new Map<string, number>();
  for (const w of jd.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ+#.]{2,}/g) ?? []) {
    if (STOP.has(w) || cvWords.has(w) || w.length < 4) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

/** Anything still bracketed is a hole you have to fill before sending. */
export const openPlaceholders = (text: string) => text.match(/\[[^\]\n]{3,}\]/g) ?? [];
