import { useLayoutEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown.ts';

/** A4 at 96 dpi. The page is always laid out at this size, then scaled to fit. */
const PAGE_W = 794;
const PAGE_H = 1123;

/**
 * A document shown as the printed page it becomes.
 *
 * It never reflows: the page is laid out at real A4 width with real margins and type sizes,
 * then scaled down as a whole to fit the space it is given — so what you see on a laptop, in a
 * side panel or on a phone is the same page the PDF export draws, just smaller.
 */
export default function CVSheet({ markdown, className = '' }: { markdown: string; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(PAGE_H);

  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const s = Math.min(1, outer.current.clientWidth / PAGE_W);
      setScale(s);
      setHeight(inner.current.offsetHeight * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [markdown]);

  return (
    // `className` (e.g. the entrance animation) goes on the wrapper: the page's own transform is the scale.
    <div ref={outer} className={`w-full ${className}`} style={{ height }}>
      <div
        ref={inner}
        className="cv-page mx-auto origin-top-left rounded-[3px] shadow-xl"
        style={{ width: PAGE_W, minHeight: PAGE_H, transform: `scale(${scale})`, marginLeft: scale < 1 ? 0 : undefined }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
      />
    </div>
  );
}
