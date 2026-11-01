import { useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { brandSchema } from '../lib/api';
import type { Brand } from '../lib/api';
import { useInfiniteQuery } from '../lib/infinite-query';
import { ScrollList, VirtualItems } from './scroll-list';
import { Field } from './ui';

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
  const list = useInfiniteQuery(
    `/manage/brands?${new URLSearchParams({ q: search }).toString()}`,
    schema,
    JSON.stringify(revision),
  );
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
      <ScrollList
        {...list.scrollProps}
        count={list.items.length}
        label="Brands"
        className={className}
      >
        <VirtualItems>{list.items.map(render)}</VirtualItems>
        {!list.items.length && !list.loading ? (
          <p className="muted">No matching brands.</p>
        ) : null}
      </ScrollList>
    </>
  );
}
