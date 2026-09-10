import { useCallback, useEffect, useState } from 'react';
import type { Store } from './types.ts';

const json = async (res: Response) => {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
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
};

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
