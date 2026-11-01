import { useCallback, useEffect, useState } from 'react';
import type { SetStateAction } from 'react';
import type { z } from 'zod';
import { api } from './api';
import { ErrorMessage } from '../components/ui';

type Cursor = Record<string, string | number> | null;
interface Result {
  items: { id: string }[];
  next: Cursor;
}

export function useInfiniteQuery<P extends Result>(
  url: string,
  schema: z.ZodType<P>,
  revision: string | number = 0,
  enabled = true,
) {
  const scope = `${url}:${String(revision)}:${String(enabled)}`;
  const initial = () => ({
    scope,
    items: [] as P['items'],
    data: null as P | null,
    next: null as Cursor,
    cursor: null as Cursor,
    loading: enabled,
    error: '',
    retry: 0,
    generation: 0,
  });
  const [state, setState] = useState(initial);
  if (state.scope !== scope) setState(initial());
  const { cursor, retry } = state;
  useEffect(() => {
    if (!enabled || state.scope !== scope) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(cursor ?? {}))
      params.set(key, String(value));
    const path =
      url +
      (params.size ? (url.includes('?') ? '&' : '?') + params.toString() : '');
    api(path, schema, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState((current) => {
          if (current.scope !== scope || current.cursor !== cursor)
            return current;
          const rows = new Map<string, P['items'][number]>();
          for (const row of cursor === null ? [] : current.items)
            rows.set(row.id, row);
          for (const row of data.items) rows.set(row.id, row);
          const next =
            data.next !== null &&
            JSON.stringify(data.next) !== JSON.stringify(cursor) &&
            data.items.length
              ? data.next
              : null;
          return {
            ...current,
            data,
            items: [...rows.values()],
            next,
            loading: false,
            error: '',
          };
        });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setState((current) =>
            current.scope === scope
              ? { ...current, loading: false, error: ErrorMessage(reason) }
              : current,
          );
      });
    return () => {
      controller.abort();
    };
  }, [url, schema, scope, cursor, retry, enabled, state.scope]);
  const loadMore = useCallback(() => {
    setState((current) =>
      !current.loading && !current.error && current.next
        ? { ...current, cursor: current.next, loading: true }
        : current,
    );
  }, []);
  const refresh = useCallback(() => {
    setState((current) => ({
      ...current,
      items: [],
      data: null,
      next: null,
      cursor: null,
      loading: true,
      error: '',
      retry: current.retry + 1,
      generation: current.generation + 1,
    }));
  }, []);
  const retryRequest = useCallback(() => {
    setState((current) => ({
      ...current,
      loading: true,
      error: '',
      retry: current.retry + 1,
    }));
  }, []);
  const setItems = useCallback((value: SetStateAction<P['items']>) => {
    setState((current) => ({
      ...current,
      items: typeof value === 'function' ? value(current.items) : value,
    }));
  }, []);
  const scrollProps = {
    loading: state.scope !== scope || state.loading,
    error: state.scope === scope ? state.error : '',
    hasMore: state.scope === scope && state.next !== null,
    loadMore,
    retry: retryRequest,
    resetKey: `${scope}:${String(state.generation)}`,
    loadKey: JSON.stringify(state.next),
  };
  return {
    items: state.scope === scope ? state.items : [],
    data: state.scope === scope ? state.data : null,
    ...scrollProps,
    refresh,
    setItems,
    scrollProps,
  };
}
