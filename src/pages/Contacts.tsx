import { useState } from 'react';
import { Area, Button, Card, Empty, Field, Select, SectionTitle } from '../components/ui.tsx';
import { api, daysUntil, fmtDate } from '../lib/api.ts';
import type { Contact, Store } from '../lib/types.ts';

export default function Contacts({ store, reload }: { store: Store; reload: () => Promise<void> }) {
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
      <SectionTitle right={<Button variant="primary" onClick={add}>+ Person</Button>}>
        Network {overdue.length > 0 && <span className="ml-2 text-amber-600">· {overdue.length} follow-up{overdue.length > 1 ? 's' : ''} due</span>}
      </SectionTitle>

      {store.contact.length === 0 ? (
        <Empty>
          Referrals decide these processes far more than applications do. Add every alum, recruiter and desk person you speak to,
          and give each one a date to come back around.
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Where</th>
                <th className="px-3 py-2 text-left font-medium">How you met</th>
                <th className="px-3 py-2 text-right font-medium">Last</th>
                <th className="px-3 py-2 text-right font-medium">Next</th>
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
            {dirty ? 'Save' : 'Saved'}
          </Button>
          <Button variant="danger" onClick={async () => {
            if (!confirm(`Delete ${contact.name}?`)) return;
            await api.remove('contact', contact.id); await reload(); close();
          }}>Delete</Button>
          <Button variant="ghost" onClick={close}>Close</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-3">
          <Field label="Name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          <Field label="Company" value={draft.company} onChange={(e) => set({ company: e.target.value })} />
          <Field label="Their role" value={draft.role} onChange={(e) => set({ role: e.target.value })} />
          <Select label="Linked application" value={draft.application_id ?? ''}
                  onChange={(e) => set({ application_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— none —</option>
            {store.application.map((a) => <option key={a.id} value={a.id}>{a.company} — {a.role || 'role TBD'}</option>)}
          </Select>
        </div>
        <div className="space-y-3">
          <Field label="Email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />
          <Field label="LinkedIn" value={draft.linkedin} onChange={(e) => set({ linkedin: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Last contact" type="date" value={draft.last_touch} onChange={(e) => set({ last_touch: e.target.value })} />
            <Field label="Follow up on" type="date" value={draft.next_touch} onChange={(e) => set({ next_touch: e.target.value })} />
          </div>
        </div>
        <div className="space-y-3">
          <Field label="How you met" value={draft.how_met} onChange={(e) => set({ how_met: e.target.value })}
                 placeholder="University alum, careers fair, referral from…" />
          <Area label="Notes" rows={6} value={draft.notes} onChange={(e) => set({ notes: e.target.value })}
                placeholder="What they said, what they offered, what you promised to send." />
        </div>
      </div>
    </Card>
  );
}
