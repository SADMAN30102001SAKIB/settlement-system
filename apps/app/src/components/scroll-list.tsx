import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { HTMLAttributes, ReactElement, ReactNode, RefObject } from 'react';
import { Spinner } from './ui';

const ScrollContext = createContext<{
  root: RefObject<HTMLDivElement | null>;
  focused: number | null;
} | null>(null);

export function ScrollList({
  children,
  count,
  hasMore = false,
  loading = false,
  error = '',
  loadMore,
  retry,
  resetKey = '',
  loadKey = '',
  className = '',
  label = 'Entries',
  ...props
}: {
  children: ReactNode;
  count: number;
  hasMore?: boolean;
  loading?: boolean;
  error?: string;
  loadMore?: () => void;
  retry?: () => void;
  resetKey?: string;
  loadKey?: string;
  label?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const root = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const requested = useRef('');
  const [focused, setFocused] = useState<number | null>(null);
  useEffect(() => {
    if (root.current) root.current.scrollTop = 0;
    requested.current = '';
  }, [resetKey]);
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore || loading || error || !loadMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const token = `${resetKey}:${String(count)}:${loadKey}`;
        if (
          entries.some((entry) => entry.isIntersecting) &&
          requested.current !== token
        ) {
          requested.current = token;
          loadMore();
        }
      },
      { root: root.current, rootMargin: '0px 0px 160px 0px' },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading, error, loadMore, resetKey, count, loadKey]);
  return (
    <ScrollContext value={{ root, focused }}>
      <div
        {...props}
        ref={root}
        className={`scroll-list ${className}`}
        role="region"
        aria-label={label}
        aria-busy={loading}
        data-loaded-count={count}
        onFocusCapture={(event) => {
          const row = event.target.closest<HTMLElement>('[data-index]');
          setFocused(row ? Number(row.dataset['index']) : null);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(null);
        }}
      >
        {children}
        <div ref={sentinel} className="scroll-list-status" aria-live="polite">
          {error ? (
            <>
              <span>{error}</span>
              {retry ? (
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => {
                    requested.current = '';
                    retry();
                  }}
                >
                  Retry loading
                </button>
              ) : null}
            </>
          ) : loading ? (
            <>
              <Spinner size={12} /> Loading…
            </>
          ) : !hasMore && count > 0 ? (
            'End of list'
          ) : null}
        </div>
      </div>
    </ScrollContext>
  );
}

interface WindowEntry {
  key: string;
  render: () => ReactElement;
}

function WindowedItems({
  children,
  entries,
  table = false,
  columns = 1,
}: {
  children?: ReactNode;
  entries?: readonly WindowEntry[];
  table?: boolean;
  columns?: number;
}) {
  const context = useContext(ScrollContext);
  const rows =
    entries ??
    Children.toArray(children)
      .filter(isValidElement)
      .map((row, index) => ({
        key: String(row.key ?? index),
        render: () => row,
      }));
  const estimate = table ? 72 : 120;
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  let total = 0;
  const positions: {
    index: number;
    key: string | number;
    start: number;
    end: number;
  }[] = [];
  for (const [index, row] of rows.entries()) {
    const height = sizes[row.key] ?? estimate;
    const item = {
      index,
      key: row.key,
      start: total,
      end: total + height,
    };
    total += height;
    positions.push(item);
  }
  const first = positions.findIndex((item) => item.end > viewport.top);
  const start = Math.max(0, (first < 0 ? rows.length - 1 : first) - 4);
  const last = positions.findIndex(
    (item) => item.start >= viewport.top + viewport.height,
  );
  const endIndex = Math.min(rows.length, (last < 0 ? rows.length : last) + 4);
  const indexes = Array.from(
    { length: Math.max(0, endIndex - start) },
    (_, index) => start + index,
  );
  if (
    context?.focused !== null &&
    context?.focused !== undefined &&
    context.focused < rows.length
  )
    indexes.push(context.focused);
  const items = [...new Set(indexes)]
    .sort((a, b) => a - b)
    .flatMap((index) => (positions[index] ? [positions[index]] : []));
  const rowKeys = JSON.stringify(rows.map((row) => row.key));
  useEffect(() => {
    const root = context?.root.current;
    if (!root) return;
    const keys = JSON.parse(rowKeys) as string[];
    let frame = 0;
    const measure = () => {
      frame = 0;
      const heading = table
        ? (root.querySelector('thead')?.getBoundingClientRect().height ?? 0)
        : 0;
      const top = Math.max(0, root.scrollTop - heading),
        height = root.clientHeight;
      setViewport((current) =>
        current.top === top && current.height === height
          ? current
          : { top, height },
      );
      const measured: Record<string, number> = {};
      for (const element of root.querySelectorAll<HTMLElement>(
        '[data-index]',
      )) {
        const index = Number(element.dataset['index']);
        const key = keys[index];
        if (key !== undefined)
          measured[key] = element.getBoundingClientRect().height;
      }
      setSizes((current) =>
        Object.entries(measured).some(
          ([key, value]) =>
            value > 0 && Math.abs((current[key] ?? estimate) - value) > 0.5,
        )
          ? { ...current, ...measured }
          : current,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    for (const element of root.querySelectorAll('[data-index]'))
      observer.observe(element);
    root.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      root.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
    };
  }, [
    context?.root,
    rowKeys,
    start,
    endIndex,
    context?.focused,
    table,
    estimate,
  ]);
  const gap = (height: number, key: string) =>
    height > 0 ? (
      table ? (
        <tr key={key} aria-hidden="true" className="virtual-spacer">
          <td colSpan={columns} style={{ height, padding: 0, border: 0 }} />
        </tr>
      ) : (
        <div key={key} aria-hidden="true" style={{ height }} />
      )
    ) : null;
  const output: ReactNode[] = [];
  let end = 0;
  for (const item of items) {
    output.push(gap(item.start - end, `gap-${String(item.key)}`));
    const row = rows[item.index]?.render() as
      | ReactElement<
          HTMLAttributes<HTMLElement> & {
            ref?: (element: HTMLElement | null) => void;
            'data-index'?: number;
          }
        >
      | undefined;
    if (row)
      output.push(
        cloneElement(row, {
          key: item.key,
          'data-index': item.index,
        }),
      );
    end = item.end;
  }
  output.push(gap(total - end, 'tail'));
  return table ? (
    <tbody>{output}</tbody>
  ) : (
    <div className="virtual-items">{output}</div>
  );
}

export function VirtualBody(props: { children: ReactNode; columns: number }) {
  return <WindowedItems {...props} table />;
}
export function VirtualItems(props: {
  children?: ReactNode;
  entries?: readonly WindowEntry[];
}) {
  return <WindowedItems {...props} />;
}
