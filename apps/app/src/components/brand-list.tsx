import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, brandSchema } from '../lib/api';
import type { Brand } from '../lib/api';
import { useCursor } from '../lib/pagination';
import { Pagination } from './pagination';
import { Alert, ErrorMessage, Field, Skeleton } from './ui';

const schema = z.object({
  items: z.array(brandSchema),
  next: z.object({ after: z.string() }).nullable(),
});
export function BrandList({
  revision,
  render,
  className = 'brand-list',
}: {
  revision: readonly Brand[];
  render: (brand: Brand) => ReactNode;
  className?: string;
}) {
  const [search, setSearch] = useState('');
  const pager = useCursor<{ after: string }>(search);
  const [data, setData] = useState<z.infer<typeof schema>>({
    items: [],
    next: null,
  });
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState('');
  const params = new URLSearchParams({ q: search, ...pager.cursor }).toString();
  const pending = loaded !== params;
  useEffect(() => {
    const controller = new AbortController();
    api(`/manage/brands?${params}`, schema, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoaded(params);
          setError('');
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(ErrorMessage(reason));
          setLoaded(params);
        }
      });
    return () => {
      controller.abort();
    };
  }, [params, revision]);
  return (
    <>
      <Field label="Search brands">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      {pending ? (
        <Skeleton height={80} />
      ) : (
        <div className={className}>
          {data.items.map(render)}
          {!data.items.length ? (
            <p className="muted">No matching brands.</p>
          ) : null}
        </div>
      )}
      <Pagination
        label="brands"
        page={pager.page}
        hasPrevious={pager.hasPrevious}
        hasNext={data.next !== null}
        pending={pending}
        onPrevious={pager.back}
        onNext={() => {
          if (data.next) pager.setCursor(data.next);
        }}
      />
    </>
  );
}
