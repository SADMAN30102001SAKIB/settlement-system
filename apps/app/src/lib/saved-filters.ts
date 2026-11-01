import { useEffect, useState } from 'react';
import { z } from 'zod';

export function useSavedFilters<T extends Record<string, string>>(
  key: string,
  initial: T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = z
        .record(z.string(), z.string().max(120))
        .parse(
          JSON.parse(sessionStorage.getItem(`hexa-filters:${key}`) ?? '{}'),
        );
      return Object.fromEntries(
        Object.entries(initial).map(([field, fallback]) => [
          field,
          saved[field] ?? fallback,
        ]),
      ) as T;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(`hexa-filters:${key}`, JSON.stringify(value));
    } catch {
      /* Filtering still works when browser storage is unavailable. */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
