import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { LetterLayout } from '../../../shared/letter';
import {
  fitLetterTables,
  sheetCount,
  sheetGap,
  sheetMetrics,
} from './letter-layout';

export function LetterSheets({
  layout,
  editing,
  children,
}: {
  layout: LetterLayout;
  editing: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(1);
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  const paged = !editing || layout.mode === 'pages';
  const { width, height, left, right, top, bottom } = sheetMetrics(layout);
  useLayoutEffect(() => {
    const host = root.current;
    const flow =
      track.current?.querySelector<HTMLElement>('.letter-sheet-flow');
    if (!host || !flow) return;
    let frame = 0;
    function measure() {
      if (!host || !flow) return;
      fitLetterTables(flow);
      const nextScale =
        !editing && fit ? Math.min(1, host.clientWidth / width) : 1;
      setScale(nextScale || 1);
      setPages(paged ? sheetCount(flow, layout) : 1);
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    const size = new ResizeObserver(schedule);
    size.observe(host);
    size.observe(flow);
    const content = new MutationObserver(schedule);
    content.observe(flow, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
    flow.addEventListener('load', schedule, true);
    document.fonts.addEventListener('loadingdone', schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      content.disconnect();
      flow.removeEventListener('load', schedule, true);
      document.fonts.removeEventListener('loadingdone', schedule);
    };
  }, [editing, fit, layout, paged, width]);
  const style = {
    '--letter-width': `${String(width)}px`,
    '--letter-height': `${String(height)}px`,
    '--letter-left': `${String(left)}px`,
    '--letter-right': `${String(right)}px`,
    '--letter-top': `${String(top)}px`,
    '--letter-bottom': `${String(bottom)}px`,
    '--letter-gap': `${String(sheetGap)}px`,
    '--letter-color': layout.color,
    '--letter-scale': scale,
    '--letter-pages': pages,
  } as CSSProperties;
  return (
    <div
      className={`letter-sheets ${paged ? 'letter-paged' : 'letter-pageless'} ${editing ? 'letter-draft' : 'letter-saved'}`}
      style={style}
    >
      {paged ? (
        <div className="letter-sheets-guide no-print">
          <small>
            {pages} {pages === 1 ? 'page' : 'pages'}
            {pages > 1 ? ' · Scroll sideways to see more' : ''}
          </small>
          {!editing ? (
            <button
              type="button"
              className="secondary compact"
              onClick={() => {
                setFit(!fit);
              }}
            >
              {fit ? 'Actual size' : 'Fit to screen'}
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        ref={root}
        className="letter-sheets-viewport"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The page strip scrolls horizontally with the keyboard.
        tabIndex={0}
        role="region"
        aria-label={editing ? 'Letter editing surface' : 'Letter pages'}
      >
        <div className="letter-sheets-track" ref={track}>
          {children}
        </div>
      </div>
    </div>
  );
}
