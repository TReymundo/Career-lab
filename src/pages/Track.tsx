import { useState } from 'react';
import { useT } from '../lib/i18n.ts';
import type { Store } from '../lib/types.ts';
import Tabs from '../components/Tabs.tsx';
import Pipeline from './Pipeline.tsx';
import Dashboard from './Dashboard.tsx';

/** Step 4: the board of every application, and the numbers on how the search is going. */
export default function Track({ store, reload }: { store: Store; reload: () => Promise<void> }) {
  const t = useT();
  const [view, setView] = useState<'board' | 'overview'>('board');
  return (
    <div className="space-y-6">
      <Tabs value={view} onChange={setView} tabs={[
        { key: 'board', label: t('Board', 'Tablero'), count: store.application.length },
        { key: 'overview', label: t('How it’s going', 'Cómo va') },
      ]} />
      <div key={view} className="page-up">
        {view === 'board' ? <Pipeline store={store} reload={reload} /> : <Dashboard store={store} reload={reload} overviewOnly />}
      </div>
    </div>
  );
}
