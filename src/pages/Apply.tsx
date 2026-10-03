import { useState } from 'react';
import { useT } from '../lib/i18n.ts';
import type { Store } from '../lib/types.ts';
import Tabs from '../components/Tabs.tsx';
import ApplyKits from '../components/ApplyKits.tsx';
import Documents from './Documents.tsx';

/**
 * Step 3: turning saved jobs into applications. "Write" is the job-by-job (or all-at-once)
 * CV writer; "Documents" is everything already written, to read, edit and download.
 */
export default function Apply({ store, reload, tab }: { store: Store; reload: () => Promise<void>; tab: 'write' | 'docs' }) {
  const t = useT();
  const [view, setView] = useState<'write' | 'docs'>(tab);
  const written = store.document.filter((d) => d.application_id !== null).length;

  return (
    <div className="space-y-6">
      <Tabs value={view} onChange={setView} tabs={[
        { key: 'write', label: t('Your kits', 'Tus kits') },
        { key: 'docs', label: t('All documents', 'Todos los documentos'), count: written },
      ]} />
      <div key={view} className="page-up">
        {view === 'write' ? <ApplyKits store={store} reload={reload} /> : <Documents store={store} reload={reload} />}
      </div>
    </div>
  );
}
