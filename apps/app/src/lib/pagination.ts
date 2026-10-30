import { useState } from 'react';

export function usePage<T>(items: readonly T[], key = '') {
  const [state, setState] = useState({ key, page: 0 });
  const page = Math.min(
    state.key === key ? state.page : 0,
    Math.max(0, Math.ceil(items.length / 20) - 1),
  );
  if (state.key !== key || state.page !== page) setState({ key, page });
  const setPage = (value: number) => {
    setState({ key, page: Math.max(0, value) });
  };
  return {
    items: items.slice(page * 20, page * 20 + 20),
    setPage,
    controls: {
      page: page + 1,
      hasPrevious: page > 0,
      hasNext: (page + 1) * 20 < items.length,
      onPrevious: () => {
        setPage(page - 1);
      },
      onNext: () => {
        setPage(page + 1);
      },
    },
  };
}

export function useCursor<T>(key = '') {
  const [state, setState] = useState<{ key: string; pages: (T | null)[] }>({
    key,
    pages: [null],
  });
  const pages = state.key === key ? state.pages : [null];
  if (state.key !== key) setState({ key, pages: [null] });
  return {
    cursor: pages.at(-1) ?? null,
    page: pages.length,
    hasPrevious: pages.length > 1,
    setCursor: (cursor: T | null) => {
      setState({ key, pages: cursor === null ? [null] : [...pages, cursor] });
    },
    back: () => {
      setState({ key, pages: pages.length > 1 ? pages.slice(0, -1) : [null] });
    },
  };
}
