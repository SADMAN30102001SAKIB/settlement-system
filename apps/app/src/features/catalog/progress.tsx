import { useState } from 'react';
import { z } from 'zod';
import { Field } from '../../components/ui';
import { ScrollList, VirtualBody } from '../../components/scroll-list';
import { useInfiniteQuery } from '../../lib/infinite-query';

const schema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      brandName: z.string(),
      period: z.string(),
      date: z.string(),
      invoiceNumber: z.string(),
    }),
  ),
  next: z.object({ before: z.string(), beforeId: z.string() }).nullable(),
});

export function Progress({ brandId }: { brandId: string }) {
  const [kind, setKind] = useState('settlements');
  const list = useInfiniteQuery(
    `/manage/progress?${new URLSearchParams({ kind, ...(brandId ? { brandId } : {}) }).toString()}`,
    schema,
  );
  return (
    <section className="panel">
      <h2>Automatic invoice progress</h2>
      <p className="muted">
        Completed work from saved invoices, independent of manual notes. Newest
        first; load older records as needed.
      </p>
      <Field label="Completed work">
        <select
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
          }}
        >
          <option value="settlements">Settlement calculated</option>
          <option value="advertising">Advertising invoice ready</option>
        </select>
      </Field>
      <ScrollList
        {...list.scrollProps}
        count={list.items.length}
        className="table-scroll"
        label="Completed invoices"
      >
        <table>
          <thead>
            <tr>
              <th>Brand</th>
              <th>Period</th>
              <th>Date</th>
              <th>Completed invoice</th>
            </tr>
          </thead>
          <VirtualBody columns={4}>
            {list.items.map((item) => (
              <tr key={item.id}>
                <td>{item.brandName}</td>
                <td>{item.period}</td>
                <td>{item.date}</td>
                <td>{item.invoiceNumber}</td>
              </tr>
            ))}
          </VirtualBody>
        </table>
      </ScrollList>
      {!list.loading && !list.items.length ? (
        <p className="muted">No saved invoices in this view.</p>
      ) : null}
    </section>
  );
}
