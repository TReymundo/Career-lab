import { useMemo, useState } from 'react';
import { Area, Badge, Button, Card, Empty, Field, Select, SectionTitle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import { QUESTIONS, coachText, countWords, questionText } from '../lib/questions.ts';
import type { Answer, Lang, Store } from '../lib/types.ts';

/**
 * One master answer per standard question, plus per-firm variants where the question
 * genuinely demands one. The master is what you paste when a form surprises you at 11pm.
 */
export default function Answers({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const ui = useUILang();
  const [lang, setLang] = useState<Lang>(ui);
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
          <p className="text-xs text-ink-500">{t('master answers written', 'respuestas base escritas')}</p>
        </div>
        <Select label={t('Answer language', 'Idioma de la respuesta')} value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="w-36">
          <option value="en">English</option>
          <option value="es">Español</option>
        </Select>
        <Select label={t('Variant for', 'Variante para')} value={company} onChange={(e) => setCompany(e.target.value)} className="w-56">
          <option value="">{t('Master answers (reusable)', 'Respuestas base (reutilizables)')}</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <p className="max-w-md text-xs text-ink-500">
          {company
            ? t(`Editing the ${company} variant. Anything you leave empty falls back to the master answer.`,
                 `Editando la variante de ${company}. Lo que dejes vacío usa la respuesta base.`)
            : t('These are your reusable answers. Pick a company above to write a variant where the question needs one.',
                'Estas son tus respuestas reutilizables. Elegí una empresa arriba para escribir una variante donde haga falta.')}
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
                    {text.trim() ? text.slice(0, 110)
                      : fallback.trim() ? `↳ ${t('using master answer', 'usando la respuesta base')}: ${fallback.slice(0, 90)}`
                      : t('Not written yet', 'Todavía sin escribir')}
                  </span>
                </span>
                {q.perFirm && <Badge tone="violet">{t('per firm', 'por empresa')}</Badge>}
                {text.trim()
                  ? <Badge tone={over ? 'rose' : 'emerald'}>{words}/{limit}</Badge>
                  : <Badge tone="slate">{limit} {t('words', 'palabras')}</Badge>}
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
  const t = useT();

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
        placeholder={placeholder
          ? `${t('Master answer (leave empty to reuse it)', 'Respuesta base (dejalo vacío para reusarla)')}:\n\n${placeholder}`
          : t('Write it once. You will paste this into a lot of forms.', 'Escribila una vez. La vas a pegar en muchos formularios.')}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm tabular-nums ${over ? 'text-rose-600' : 'text-ink-500'}`}>
          {words} {t('words', 'palabras')}{wordLimit > 0 && ` / ${wordLimit}`}{over && ` — ${words - wordLimit} ${t('over', 'de más')}`}
        </span>
        <Field type="number" value={wordLimit} min={0} onChange={(e) => setWordLimit(Number(e.target.value))}
               className="w-24" title="Word limit on the form" />
        <Button variant="primary" disabled={!dirty} onClick={save}>{dirty ? t('Save', 'Guardar') : t('Saved', 'Guardado')}</Button>
        <Button onClick={() => navigator.clipboard.writeText(text || placeholder || '')}>{t('Copy', 'Copiar')}</Button>
        {row && (
          <Button variant="ghost" onClick={async () => {
            await api.update('answer', row.id, { times_used: (row.times_used ?? 0) + 1 });
            await reload();
          }}>
            {t('Used it', 'La usé')} ({row.times_used ?? 0})
          </Button>
        )}
        {saved && <span className="animate-fade text-sm text-brand-700">{t('Saved', 'Guardado')}</span>}
      </div>
    </>
  );
}
