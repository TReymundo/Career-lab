import { useMemo, useState } from 'react';
import { Area, Badge, Button, Card, Empty, Field, Select, SectionTitle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { QUESTIONS, coachText, countWords, questionText } from '../lib/questions.ts';
import type { Answer, Lang, Store } from '../lib/types.ts';

/**
 * One master answer per standard question, plus per-firm variants where the question
 * genuinely demands one. The master is what you paste when a form surprises you at 11pm.
 */
export default function Answers({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const [lang, setLang] = useState<Lang>('en');
  const [company, setCompany] = useState('');
  const [openSlug, setOpenSlug] = useState<string | null>(QUESTIONS[0]?.slug ?? null);

  const companies = useMemo(
    () => [...new Set(store.application.map((a) => a.company).filter(Boolean))].sort(),
    [store.application],
  );

  const find = (slug: string, forCompany: string) =>
    store.answer.find((a) => a.slug === slug && a.company === forCompany) ?? null;

  const written = QUESTIONS.filter((q) => {
    const master = find(q.slug, '');
    return master && (master.body.trim() || master.body_es.trim());
  }).length;

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div>
          <p className="text-2xl font-semibold tabular-nums">{written}<span className="text-ink-400">/{QUESTIONS.length}</span></p>
          <p className="text-xs text-ink-500">master answers written</p>
        </div>
        <Select label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="w-36">
          <option value="en">English</option>
          <option value="es">Español</option>
        </Select>
        <Select label="Variant for" value={company} onChange={(e) => setCompany(e.target.value)} className="w-56">
          <option value="">Master answers (reusable)</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <p className="max-w-md text-xs text-ink-500">
          {company
            ? `Editing the ${company} variant. Anything you leave empty falls back to the master answer.`
            : 'These are your reusable answers. Pick a company above to write a variant where the question needs one.'}
        </p>
      </Card>

      <div className="stagger space-y-3">
        {QUESTIONS.map((q) => {
          const master = find(q.slug, '');
          const variant = company ? find(q.slug, company) : null;
          const row = company ? variant : master;
          const isOpen = openSlug === q.slug;
          const text = lang === 'es' ? (row?.body_es ?? '') : (row?.body ?? '');
          const fallback = company && !text.trim() ? (lang === 'es' ? master?.body_es : master?.body) ?? '' : '';
          const words = countWords(text || fallback);
          const limit = row?.word_limit || q.limit;
          const over = limit > 0 && words > limit;

          return (
            <Card key={q.slug} className={`overflow-hidden ${isOpen ? 'border-brand-200' : ''}`}>
              <button
                onClick={() => setOpenSlug(isOpen ? null : q.slug)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-brand-50"
              >
                <span className="text-ink-400">{isOpen ? '▾' : '▸'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink-900">{questionText(q, lang)}</span>
                  <span className="block truncate text-xs text-ink-500">
                    {text.trim() ? text.slice(0, 110) : fallback.trim() ? `↳ using master answer: ${fallback.slice(0, 90)}` : 'Not written yet'}
                  </span>
                </span>
                {q.perFirm && <Badge tone="violet">per firm</Badge>}
                {text.trim()
                  ? <Badge tone={over ? 'rose' : 'emerald'}>{words}/{limit}</Badge>
                  : <Badge tone="slate">{limit} words</Badge>}
              </button>

              {isOpen && (
                <div className="animate-fade space-y-3 border-t border-line px-4 py-4">
                  <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">{coachText(q, lang)}</p>

                  <Editor
                    key={`${q.slug}-${company}-${lang}`}
                    row={row}
                    slug={q.slug}
                    question={questionText(q, lang)}
                    company={company}
                    lang={lang}
                    limit={limit}
                    placeholder={fallback || undefined}
                    reload={reload}
                  />
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Editor({ row, slug, question, company, lang, limit, placeholder, reload }: {
  row: Answer | null; slug: string; question: string; company: string; lang: Lang;
  limit: number; placeholder?: string; reload: () => Promise<void>;
}) {
  const [text, setText] = useState(lang === 'es' ? (row?.body_es ?? '') : (row?.body ?? ''));
  const [wordLimit, setWordLimit] = useState(limit);
  const [saved, setSaved] = useState(false);

  const words = countWords(text);
  const over = wordLimit > 0 && words > wordLimit;
  const dirty = text !== (lang === 'es' ? (row?.body_es ?? '') : (row?.body ?? '')) || wordLimit !== (row?.word_limit || limit);

  const save = async () => {
    const field = lang === 'es' ? 'body_es' : 'body';
    if (row) await api.update('answer', row.id, { [field]: text, word_limit: wordLimit });
    else await api.create('answer', { slug, question, company, word_limit: wordLimit, [field]: text });
    await reload();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <>
      <Area
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ? `Master answer (leave empty to reuse it):\n\n${placeholder}` : 'Write it once. You will paste this into a lot of forms.'}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm tabular-nums ${over ? 'text-rose-600' : 'text-ink-500'}`}>
          {words} words{wordLimit > 0 && ` / ${wordLimit}`}{over && ` — ${words - wordLimit} over`}
        </span>
        <Field type="number" value={wordLimit} min={0} onChange={(e) => setWordLimit(Number(e.target.value))}
               className="w-24" title="Word limit on the form" />
        <Button variant="primary" disabled={!dirty} onClick={save}>{dirty ? 'Save' : 'Saved'}</Button>
        <Button onClick={() => navigator.clipboard.writeText(text || placeholder || '')}>Copy</Button>
        {row && (
          <Button variant="ghost" onClick={async () => {
            await api.update('answer', row.id, { times_used: (row.times_used ?? 0) + 1 });
            await reload();
          }}>
            Used it ({row.times_used ?? 0})
          </Button>
        )}
        {saved && <span className="animate-fade text-sm text-brand-700">Saved</span>}
      </div>
    </>
  );
}
