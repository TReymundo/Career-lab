import { useState } from 'react';
import { Area, Button, Card, Empty, Field, Select, SectionTitle } from '../components/ui.tsx';
import { api, daysUntil, fmtDate } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import type { Contact, Store } from '../lib/types.ts';

export default function Contacts({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const [openId, setOpenId] = useState<number | null>(null);

  const add = async () => {
    const c = await api.create<Contact>('contact', { name: 'New contact' });
    await reload();
    setOpenId(c.id);
  };

  const open = store.contact.find((c) => c.id === openId) ?? null;
  const overdue = store.contact.filter((c) => {
    const n = daysUntil(c.next_touch);
    return n !== null && n <= 0;
  });

  return (
    <div className="space-y-6">
      <SectionTitle right={<Button variant="primary" onClick={add}>{t('+ Person', '+ Persona')}</Button>}>
        {t('Network', 'Contactos')} {overdue.length > 0 && <span className="ml-2 text-amber-600">· {overdue.length} {t('due', 'pendientes')}</span>}
      </SectionTitle>

      {store.contact.length === 0 ? (
        <Empty>
          {t('Referrals decide these processes far more than applications do. Add everyone you speak to, and give each one a date to come back around.',
             'Las referencias deciden estos procesos mucho más que las postulaciones. Cargá a todos con quienes hables, y ponele a cada uno una fecha para volver.')}
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">{t('Name', 'Nombre')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('Where', 'Dónde')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('How you met', 'Cómo se conocieron')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Last', 'Último')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Next', 'Próximo')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {store.contact.map((c) => {
                const n = daysUntil(c.next_touch);
                return (
                  <tr key={c.id} onClick={() => setOpenId(c.id)}
                      className={`cursor-pointer hover:bg-brand-50 ${openId === c.id ? 'bg-brand-50' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-ink-900">{c.name}</td>
                    <td className="px-3 py-2.5 text-ink-500">{[c.role, c.company].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="max-w-64 truncate px-3 py-2.5 text-ink-500">{c.how_met || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-ink-500">{fmtDate(c.last_touch)}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                      <span className={n === null ? 'text-ink-400' : n < 0 ? 'text-rose-600' : n <= 2 ? 'text-amber-600' : 'text-ink-500'}>
                        {fmtDate(c.next_touch)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {open && <Detail key={open.id} contact={open} store={store} reload={reload} close={() => setOpenId(null)} />}
    </div>
  );
}

function Detail({ contact, store, reload, close }: { contact: Contact; store: Store; reload: () => Promise<void>; close: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<Contact>(contact);
  const set = (patch: Partial<Contact>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(contact);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between">
        <h2 className="text-lg font-semibold">{draft.name || 'Untitled'}</h2>
        <div className="flex gap-2">
          <Button variant="primary" disabled={!dirty}
                  onClick={async () => { await api.update('contact', contact.id, draft); await reload(); }}>
            {dirty ? t('Save', 'Guardar') : t('Saved', 'Guardado')}
          </Button>
          <Button variant="danger" onClick={async () => {
            if (!confirm(`Delete ${contact.name}?`)) return;
            await api.remove('contact', contact.id); await reload(); close();
          }}>{t('Delete', 'Eliminar')}</Button>
          <Button variant="ghost" onClick={close}>{t('Close', 'Cerrar')}</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-3">
          <Field label={t('Name', 'Nombre')} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          <Field label={t('Company', 'Empresa')} value={draft.company} onChange={(e) => set({ company: e.target.value })} />
          <Field label={t('Their role', 'Su puesto')} value={draft.role} onChange={(e) => set({ role: e.target.value })} />
          <Select label={t('Linked application', 'Postulación vinculada')} value={draft.application_id ?? ''}
                  onChange={(e) => set({ application_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— none —</option>
            {store.application.map((a) => <option key={a.id} value={a.id}>{a.company} — {a.role || 'role TBD'}</option>)}
          </Select>
        </div>
        <div className="space-y-3">
          <Field label={t('Email', 'Email')} value={draft.email} onChange={(e) => set({ email: e.target.value })} />
          <Field label={t('LinkedIn', 'LinkedIn')} value={draft.linkedin} onChange={(e) => set({ linkedin: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Last contact', 'Último contacto')} type="date" value={draft.last_touch} onChange={(e) => set({ last_touch: e.target.value })} />
            <Field label={t('Follow up on', 'Volver a escribir el')} type="date" value={draft.next_touch} onChange={(e) => set({ next_touch: e.target.value })} />
          </div>
        </div>
        <div className="space-y-3">
          <Field label={t('How you met', 'Cómo se conocieron')} value={draft.how_met} onChange={(e) => set({ how_met: e.target.value })}
                 placeholder="University alum, careers fair, referral from…" />
          <Area label={t('Notes', 'Notas')} rows={6} value={draft.notes} onChange={(e) => set({ notes: e.target.value })}
                placeholder="What they said, what they offered, what you promised to send." />
        </div>
      </div>
    </Card>
  );
}
