import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export function DocumentPreview({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const mobile = window.matchMedia('(max-width: 680px)');
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      setScale(mobile.matches && width > 0 ? Math.min(1, width / 794) : 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    mobile.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      mobile.removeEventListener('change', measure);
    };
  }, []);
  return (
    <div
      className="document-preview"
      ref={root}
      style={{ '--document-scale': fit ? scale : 1 } as CSSProperties}
    >
      <div className="document-preview-controls no-print">
        <span>Document preview</span>
        <button
          className="secondary compact"
          onClick={() => {
            setFit(!fit);
          }}
        >
          {fit ? 'Actual size' : 'Fit to screen'}
        </button>
      </div>
      <div className="document-preview-viewport">{children}</div>
    </div>
  );
}
