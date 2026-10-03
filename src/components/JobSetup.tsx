import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button, Card, Field, Select } from './ui.tsx';
import { api, type SourcesStatus } from '../lib/api.ts';
import { useT, useUILang } from '../lib/i18n.ts';
import { buildCV } from '../lib/templates.ts';
import { COUNTRY_CODES, FIELDS, alertLinks, fieldsFromTracks, type JobPrefs } from '../lib/jobsearch.ts';
import { parseBullets, type Store } from '../lib/types.ts';
import KeyBox, { useAiStatus } from './KeyBox.tsx';

/**
 * The two screens before the job list: what you are looking for, then where jobs come from.
 * Both are one decision each, in the same style as the CV questions, and both can be
 * reopened later from the list.
 */

function Chip({ on, onClick, children, onRemove }: { on: boolean; onClick?: () => void; children: ReactNode; onRemove?: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border text-sm transition ${
      on ? 'border-brand-400 bg-brand-50 font-medium text-brand-700' : 'border-line bg-surface text-ink-700 hover:border-line-strong'}`}>
      <button onClick={onClick} className="px-3.5 py-2">{children}</button>
      {onRemove && <button onClick={onRemove} className="-ml-1 pr-3 text-ink-400 hover:text-rose-600">✕</button>}
    </span>
  );
}

const CITY_PRESETS: Record<string, string[]> = {
  AR: ['CABA', 'GBA Norte', 'GBA Sur', 'GBA Oeste', 'La Plata', 'Córdoba', 'Rosario', 'Mendoza'],
  CO: ['Bogotá', 'Medellín', 'Cali'], CL: ['Santiago'], UY: ['Montevideo'], MX: ['Ciudad de México', 'Monterrey', 'Guadalajara'],
  PE: ['Lima'], ES: ['Madrid', 'Barcelona'],
};

const guessPlace = (location: string): JobPrefs['places'][number] | null => {
  const l = location.toLowerCase();
  const c = COUNTRY_CODES.find((x) => l.includes(x.es.toLowerCase()) || l.includes(x.en.toLowerCase()));
  if (!c) return null;
  const city = location.split(',')[0].trim();
  return { label: city && city.toLowerCase() !== c.es.toLowerCase() ? `${city}, ${c.es}` : c.es, country: c.code, city: city.toLowerCase() === c.es.toLowerCase() ? '' : city };
};

/* ---------------------------------------------------------------- what you are looking for */

export function PrefsStep({ store, initial, onDone }: { store: Store; initial: JobPrefs | null; onDone: () => void }) {
  const t = useT();
  const lang = useUILang();
  const [roles, setRoles] = useState<string[]>(initial?.roles ?? (store.profile.headline ? [store.profile.headline] : []));
  const [suggested, setSuggested] = useState<string[]>([]);
  const [newRole, setNewRole] = useState('');
  const [places, setPlaces] = useState<JobPrefs['places']>(() => {
    if (initial?.places) return initial.places;
    const g = guessPlace(store.profile.location);
    return g ? [g] : [];
  });
  const [country, setCountry] = useState('AR');
  const [city, setCity] = useState('');
  const [remote, setRemote] = useState(initial?.remote ?? true);
  const [levels, setLevels] = useState<JobPrefs['levels']>(initial?.levels ?? ['intern', 'junior']);
  const [langs, setLangs] = useState<JobPrefs['langs']>(initial?.langs ?? ['es', 'en']);
  const [fields, setFields] = useState<string[]>(() => initial?.fields ?? (() => {
    try { return fieldsFromTracks(JSON.parse(store.setting['tracks'] || '[]')); } catch { return []; }
  })());
  const [experience, setExperience] = useState<NonNullable<JobPrefs['experience']>>(initial?.experience
    ?? (store.experience.some((e) => e.kind === 'work' && parseBullets(e.bullets).length >= 2) ? 'some' : 'none'));
  const [busy, setBusy] = useState(false);
  const [aiStatus] = useAiStatus();

  /**
   * Titles to apply for, built from where you want to go and how much experience you have —
   * not only from the CV. A tech CV aiming at finance gets finance titles; no experience gets
   * internships, trainee and graduate programmes. Shown as chips to tick, never applied silently.
   */
  const suggest = () => {
    setBusy(true);
    const cv = buildCV(store.profile, store.experience, { track: 'other', lang, template: 'ats', maxBullets: 99 });
    void api.aiTitles(cv, lang, { fields: fields.map((f) => FIELDS.find((x) => x.id === f)?.en ?? f), experience })
      .then((r) => setSuggested(r.titles.slice(0, 12)))
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  useEffect(() => { if (aiStatus?.configured) suggest(); }, [aiStatus?.configured, fields.join(), experience]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * One-click places: wherever your CV says you have lived, studied or worked, then the main
   * cities of each country you have chosen.
   */
  const presets = useMemo(() => {
    const fromCV = [store.profile.location, ...store.experience.map((e) => e.location)].map((l) => guessPlace(l ?? '')).filter(Boolean) as JobPrefs['places'];
    const cities = [...new Set(places.map((p) => p.country))].flatMap((code) => {
      const c = COUNTRY_CODES.find((x) => x.code === code);
      return (CITY_PRESETS[code] ?? []).map((city) => ({ label: `${city}, ${c?.[lang] ?? code}`, country: code, city }));
    });
    const seen = new Set(places.map((p) => p.label));
    return [...fromCV, ...cities].filter((p) => !seen.has(p.label) && (seen.add(p.label), true));
  }, [store, places, lang]);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const addRole = () => { const r = newRole.trim(); if (r && !roles.includes(r)) setRoles([...roles, r]); setNewRole(''); };
  const addPlace = () => {
    const c = COUNTRY_CODES.find((x) => x.code === country)!;
    const label = city.trim() ? `${city.trim()}, ${c[lang]}` : c[lang];
    if (!places.some((p) => p.label === label)) setPlaces([...places, { label, country, city: city.trim() }]);
    setCity('');
  };

  const save = async () => {
    const prefs: JobPrefs = { roles, places, remote, levels, langs, fields, experience };
    await api.setSetting('job_prefs', JSON.stringify(prefs));
    onDone();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-sm font-medium text-brand-700">{t('Finding jobs · 1 of 2', 'Buscar avisos · 1 de 2')}</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight text-ink-900">{t('What are you looking for?', '¿Qué estás buscando?')}</h2>
        <p className="mt-2 text-sm text-ink-500">
          {t('Every search, every alert and the ranking of every job comes from this. Change it any time.',
             'Cada búsqueda, cada alerta y el orden de cada aviso salen de acá. Lo podés cambiar cuando quieras.')}
        </p>
      </div>

      <section className="space-y-3">
        <p className="text-sm font-semibold text-ink-900">{t('Where do you want to work?', '¿En qué querés trabajar?')}</p>
        <p className="-mt-2 text-xs text-ink-500">{t('It can be different from what your CV shows — this is where you want to go.', 'Puede ser distinto de lo que muestra tu CV — es a dónde querés ir.')}</p>
        <div className="flex flex-wrap gap-2">
          {FIELDS.map((f) => <Chip key={f.id} on={fields.includes(f.id)} onClick={() => setFields(toggle(fields, f.id))}>{f[lang]}</Chip>)}
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-sm font-semibold text-ink-900">{t('How much work experience do you have?', '¿Cuánta experiencia laboral tenés?')}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            ['none', t('None yet', 'Ninguna todavía'), t('Internships, trainee and graduate programmes', 'Pasantías, trainee y programas de jóvenes profesionales')],
            ['some', t('A little', 'Un poco'), t('Up to ~2 years, junior roles', 'Hasta ~2 años, puestos junior')],
            ['experienced', t('A few years', 'Algunos años'), t('Junior and semi-senior roles', 'Puestos junior y semi-senior')],
          ] as const).map(([v, label, sub]) => (
            <button key={v} onClick={() => { setExperience(v); setLevels(v === 'none' ? ['intern', 'junior'] : v === 'some' ? ['intern', 'junior'] : ['junior', 'mid']); }}
                    className={`rounded-2xl border p-3 text-left transition ${experience === v ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100' : 'border-line bg-surface hover:border-line-strong'}`}>
              <span className="block text-sm font-semibold text-ink-900">{label}</span>
              <span className="mt-0.5 block text-xs text-ink-500">{sub}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-sm font-semibold text-ink-900">{t('Job titles', 'Puestos')}</p>
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => <Chip key={r} on onRemove={() => setRoles(roles.filter((x) => x !== r))}>{r}</Chip>)}
          {suggested.filter((s) => !roles.includes(s)).map((s) => (
            <Chip key={s} on={false} onClick={() => setRoles((r) => (r.includes(s) ? r : [...r, s]))}>+ {s}</Chip>
          ))}
          {busy && <span className="self-center text-xs text-ink-400">{t('Reading your CV for ideas…', 'Leyendo tu CV para sugerir…')}</span>}
        </div>
        <div className="flex gap-2">
          <Field value={newRole} onChange={(e) => setNewRole(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addRole(); }}
                 placeholder={t('Add a title, e.g. Analista financiero', 'Agregá un puesto, ej. Analista financiero')} className="flex-1" />
          <Button onClick={addRole} disabled={!newRole.trim()}>{t('Add', 'Agregar')}</Button>
        </div>
        <p className="text-xs text-ink-400">{t('Tip: add the same role in Spanish and English — postings use both.', 'Tip: sumá el mismo puesto en español e inglés — los avisos usan los dos.')}</p>
      </section>

      <section className="space-y-3">
        <p className="text-sm font-semibold text-ink-900">{t('Where', 'Dónde')}</p>
        <p className="-mt-2 text-xs text-ink-500">
          {t('Only these places — plus remote jobs open to them — come into your list. Nothing from anywhere else.',
             'Sólo estos lugares — más los remotos abiertos a ellos — entran a tu lista. Nada de otros lados.')}
        </p>
        <div className="flex flex-wrap gap-2">
          {places.map((p) => <Chip key={p.label} on onRemove={() => setPlaces(places.filter((x) => x !== p))}>{p.label}</Chip>)}
          <Chip on={remote} onClick={() => setRemote(!remote)}>{remote ? '✓ ' : ''}{t('Remote jobs open to my country', 'Remotos abiertos a mi país')}</Chip>
        </div>
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button key={p.label} onClick={() => setPlaces((ps) => (ps.some((x) => x.label === p.label) ? ps : [...ps, p]))}
                      className="rounded-full border border-dashed border-line-strong px-3 py-1 text-xs text-ink-600 transition hover:border-brand-300 hover:text-brand-700">
                + {p.label}
              </button>
            ))}
          </div>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-ink-500 hover:text-ink-900">{t('Another country or city…', 'Otro país o ciudad…')}</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <Select value={country} onChange={(e) => setCountry(e.target.value)} className="w-44">
              {COUNTRY_CODES.map((c) => <option key={c.code} value={c.code}>{c[lang]}</option>)}
            </Select>
            <Field value={city} onChange={(e) => setCity(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addPlace(); }}
                   placeholder={t('City (optional)', 'Ciudad (opcional)')} className="min-w-40 flex-1" />
            <Button onClick={addPlace}>{t('+ Add place', '+ Agregar lugar')}</Button>
          </div>
        </details>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink-900">{t('Level', 'Nivel')}</p>
          <div className="flex flex-wrap gap-2">
            {([['intern', t('Internship', 'Pasantía')], ['junior', t('Junior / trainee', 'Junior / trainee')], ['mid', t('Semi-senior', 'Semi-senior')]] as const).map(([v, label]) => (
              <Chip key={v} on={levels.includes(v)} onClick={() => setLevels(toggle(levels, v))}>{label}</Chip>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink-900">{t('Job language', 'Idioma del aviso')}</p>
          <div className="flex flex-wrap gap-2">
            <Chip on={langs.includes('es')} onClick={() => setLangs(toggle(langs, 'es'))}>{t('Spanish', 'Español')}</Chip>
            <Chip on={langs.includes('en')} onClick={() => setLangs(toggle(langs, 'en'))}>{t('English', 'Inglés')}</Chip>
          </div>
        </div>
      </section>

      <Button variant="primary" className="px-6 py-3 text-base" disabled={!roles.length || (!places.length && !remote)} onClick={save}>
        {t('Continue →', 'Continuar →')}
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- where jobs come from */

function SourceCard({ icon, title, body, state, children }: { icon: string; title: string; body: string; state: ReactNode; children?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-xl">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink-900">{title}</p>
            {state}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">{body}</p>
          {children && <div className="mt-4 space-y-3">{children}</div>}
        </div>
      </div>
    </Card>
  );
}

export function SourcesStep({ prefs, status, setStatus, onDone }: {
  prefs: JobPrefs; status: SourcesStatus | null; setStatus: (s: SourcesStatus) => void; onDone: () => void;
}) {
  const t = useT();
  const [aiStatus, setAiStatus] = useAiStatus();
  const [user, setUser] = useState(status?.gmail.user ?? '');
  const [pass, setPass] = useState('');
  const [key, setKey] = useState('');
  const [groq, setGroq] = useState('');
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const links = alertLinks(prefs);
  const sites = [...new Set(links.map((l) => l.site))];
  const [site, setSite] = useState(sites[0] ?? 'LinkedIn');
  const refresh = async () => setStatus(await api.sourcesStatus());

  const on = <Badge tone="emerald">{t('connected', 'conectado')}</Badge>;
  const off = <Badge tone="slate">{t('not connected', 'sin conectar')}</Badge>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-700">{t('Finding jobs · 2 of 2', 'Buscar avisos · 2 de 2')}</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight text-ink-900">{t('Where should jobs come from?', '¿De dónde traemos los avisos?')}</h2>
        <p className="mt-2 text-sm text-ink-500">
          {t('Connect what you can now — each one adds more jobs, and you can add the rest later. Nothing here can post, apply or send anything.',
             'Conectá lo que puedas ahora — cada uno suma más avisos, y el resto lo agregás después. Nada de esto puede publicar, postularse ni enviar nada.')}
        </p>
      </div>

      <SourceCard icon="✦" title={t('Google AI — ranks your jobs', 'Google AI — ordena tus avisos')}
                  body={t('Needed to rank thousands of jobs against what you want, and to read alert emails. Free.',
                          'Hace falta para ordenar miles de avisos según lo que buscás, y para leer los mails de alertas. Gratis.')}
                  state={aiStatus?.configured ? on : off}>
        {!aiStatus?.configured && <KeyBox status={aiStatus} onChange={setAiStatus} reason={t('Add your free Google AI key', 'Agregá tu clave gratis de Google AI')} />}
      </SourceCard>

      <SourceCard icon="⚡" title={t('Groq — free backup AI', 'Groq — IA gratis de respaldo')}
                  body={t('When Google’s free AI is busy or out of quota, the same request goes to Groq instead of failing. Free, no card: 30 requests a minute, 1,000 a day.',
                          'Cuando la IA gratis de Google está ocupada o sin cuota, el mismo pedido va a Groq en vez de fallar. Gratis, sin tarjeta: 30 pedidos por minuto, 1.000 por día.')}
                  state={status?.groq ? on : <Badge tone="slate">{t('optional', 'opcional')}</Badge>}>
        {!status?.groq && (
          <>
            <p className="text-sm text-ink-700">
              {t('Create a key at', 'Creá una clave en')} <a className="text-brand-700 underline" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a> {t('and paste it here.', 'y pegala acá.')}
            </p>
            <div className="flex gap-2">
              <Field type="password" autoComplete="off" value={groq} onChange={(e) => setGroq(e.target.value)} placeholder="gsk_…" className="flex-1" />
              <Button variant="primary" disabled={!groq.trim()} onClick={async () => { await api.setGroqKey(groq.trim()); setGroq(''); await refresh(); }}>
                {t('Save', 'Guardar')}
              </Button>
            </div>
          </>
        )}
      </SourceCard>

      <SourceCard icon="⛵" title="Get on Board"
                  body={t('Latin America’s job board for tech, data and business roles — searched with your job titles. Public API: always on, nothing to set up.',
                          'La bolsa de trabajo de Latinoamérica para tecnología, datos y negocios — buscada con tus puestos. API pública: siempre activa, no hay que configurar nada.')}
                  state={on} />

      <SourceCard icon="🌐" title={t('Remote job boards', 'Bolsas de trabajo remoto')}
                  body={t('Remotive, Jobicy and Himalayas — only the remote roles open to your country are kept.',
                          'Remotive, Jobicy y Himalayas — sólo se guardan los remotos abiertos a tu país.')}
                  state={prefs.remote ? on : <Badge tone="slate">{t('off — remote not selected', 'apagado — no elegiste remoto')}</Badge>} />

      <SourceCard icon="G" title={t('Google for Jobs (JSearch)', 'Google for Jobs (JSearch)')}
                  body={t('Postings Google has collected from LinkedIn, Bumeran, Computrabajo, Indeed and company sites — searched by country. Free plan: 200 searches a month (about 10 jobs each).',
                          'Avisos que Google juntó de LinkedIn, Bumeran, Computrabajo, Indeed y sitios de empresas — buscados por país. Plan gratis: 200 búsquedas por mes (unos 10 avisos cada una).')}
                  state={status?.jsearch.configured ? <>{on}<span className="text-xs text-ink-400">{status.jsearch.used}/{status.jsearch.limit} {t('this month', 'este mes')}</span></> : off}>
        {!status?.jsearch.configured && (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-700">
              <li>{t('Open', 'Abrí')} <a className="text-brand-700 underline" href="https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/pricing" target="_blank" rel="noreferrer">JSearch on RapidAPI</a> {t('and sign up (free).', 'y creá una cuenta (gratis).')}</li>
              <li>{t('Subscribe to the Basic plan — $0.', 'Suscribite al plan Basic — $0.')}</li>
              <li>{t('Copy the “X-RapidAPI-Key” shown on the page and paste it here.', 'Copiá la “X-RapidAPI-Key” que aparece y pegala acá.')}</li>
            </ol>
            <div className="flex gap-2">
              <Field type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="X-RapidAPI-Key" className="flex-1" />
              <Button variant="primary" disabled={!key.trim()} onClick={async () => { await api.setJSearchKey(key.trim()); setKey(''); await refresh(); }}>
                {t('Save', 'Guardar')}
              </Button>
            </div>
          </>
        )}
      </SourceCard>

      <SourceCard icon="✉" title={t('Job alerts in your Gmail', 'Alertas de empleo en tu Gmail')}
                  body={t('How LinkedIn and local sites get in: you create job alerts there, they email you daily, and Career Lab reads only those emails (read-only) and files every job.',
                          'Así entran LinkedIn y los sitios locales: creás alertas ahí, te mandan mails todos los días, y Career Lab lee sólo esos mails (sólo lectura) y guarda cada aviso.')}
                  state={status?.gmail.configured ? <>{on}<span className="text-xs text-ink-400">{status.gmail.user}</span></> : off}>
        {!status?.gmail.configured ? (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-700">
              <li>{t('Your Google account needs 2-Step Verification on.', 'Tu cuenta de Google necesita la verificación en dos pasos activada.')}</li>
              <li>{t('Create an app password at', 'Creá una contraseña de aplicación en')} <a className="text-brand-700 underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a> {t('(name it “Career Lab”).', '(ponele “Career Lab”).')}</li>
              <li>{t('Paste the 16 letters below. It is saved in your .env file on this computer only.', 'Pegá las 16 letras acá. Se guarda en tu archivo .env, sólo en esta computadora.')}</li>
            </ol>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Field value={user} onChange={(e) => setUser(e.target.value)} placeholder="you@gmail.com" />
              <Field type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={t('App password', 'Contraseña de aplicación')} />
              <Button variant="primary" disabled={!user.trim() || !pass.trim() || busy === 'gmail'} onClick={async () => {
                setBusy('gmail'); setMsg({ ...msg, gmail: '' });
                try { await api.connectGmail(user.trim(), pass); setPass(''); await refresh(); }
                catch (e) { setMsg({ ...msg, gmail: e instanceof Error ? e.message : String(e) }); }
                setBusy('');
              }}>{busy === 'gmail' ? t('Checking…', 'Probando…') : t('Connect', 'Conectar')}</Button>
            </div>
            {msg.gmail && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{msg.gmail}</p>}
          </>
        ) : (
          <button onClick={async () => { await api.disconnectGmail(); await refresh(); }} className="text-xs text-ink-400 underline">
            {t('Disconnect Gmail', 'Desconectar Gmail')}
          </button>
        )}

        <div className="rounded-xl border border-line bg-sunken/50 p-4">
          <p className="text-sm font-medium text-ink-900">{t('Now create the alerts', 'Ahora creá las alertas')}</p>
          <p className="mt-1 text-xs text-ink-500">
            {t('Each link opens that site’s search already filled in. Click its “Set alert” / “Crear alerta” button, choose daily, done. More alerts = more jobs.',
               'Cada link abre la búsqueda de ese sitio ya completada. Tocá su botón “Crear alerta”, elegí diaria, listo. Más alertas = más avisos.')}
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            {sites.map((s) => (
              <button key={s} onClick={() => setSite(s)}
                      className={`rounded-md px-3 py-1 text-xs transition ${site === s ? 'bg-surface font-medium text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}>{s}</button>
            ))}
          </div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {links.filter((l) => l.site === site).map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
                 className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-700 transition hover:border-brand-300 hover:text-brand-700">
                <span className="min-w-0 flex-1 truncate">{l.label}</span><span className="text-brand-600">↗</span>
              </a>
            ))}
          </div>
        </div>
      </SourceCard>

      <Button variant="primary" className="px-6 py-3 text-base" onClick={onDone}>{t('Find my jobs →', 'Buscar mis avisos →')}</Button>
    </div>
  );
}
