import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Segmented tabs with a sliding highlight: the pill glides to the chosen tab instead of
 * jumping, which is most of what makes switching feel deliberate.
 */
export default function Tabs<K extends string>({ tabs, value, onChange }: {
  tabs: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const el = refs.current[value];
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, tabs.length]);

  return (
    <div className="relative inline-flex rounded-full bg-sunken p-1">
      <span className="absolute top-1 h-[calc(100%-8px)] rounded-full bg-forest-900 shadow-md transition-all duration-300 ease-out"
            style={{ left: pill.left, width: pill.width }} />
      {tabs.map((tab) => (
        <button key={tab.key} ref={(el) => { refs.current[tab.key] = el; }} onClick={() => onChange(tab.key)}
                className={`relative z-10 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-300 ${value === tab.key ? 'text-lime-300' : 'text-ink-500 hover:text-ink-900'}`}>
          {tab.label}
          {tab.count !== undefined && <span className={`ml-1.5 tabular-nums ${value === tab.key ? 'text-white/70' : 'text-ink-400'}`}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
