import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from '../../lib/api';
import { Alert, ErrorMessage, Field } from '../../components/ui';

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
  const [data, setData] = useState<z.infer<typeof schema>>({
    items: [],
    next: null,
  });
  const [cursor, setCursor] = useState<z.infer<typeof schema>['next']>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ kind });
    if (brandId) params.set('brandId', brandId);
    if (cursor) {
      params.set('before', cursor.before);
      params.set('beforeId', cursor.beforeId);
    }
    api(`/manage/progress?${params.toString()}`, schema, {
      signal: controller.signal,
    })
      .then((result) => {
        setData((previous) => ({
          items: cursor ? [...previous.items, ...result.items] : result.items,
          next: result.next,
        }));
        setError('');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => {
      controller.abort();
    };
  }, [brandId, kind, cursor]);
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
            setCursor(null);
            setData({ items: [], next: null });
            setPending(true);
          }}
        >
          <option value="settlements">Settlement calculated</option>
          <option value="advertising">Advertising invoice ready</option>
        </select>
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      {pending ? <p role="status">Loading progress…</p> : null}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Brand</th>
              <th>Period</th>
              <th>Date</th>
              <th>Completed invoice</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id}>
                <td>{item.brandName}</td>
                <td>{item.period}</td>
                <td>{item.date}</td>
                <td>{item.invoiceNumber}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!pending && !data.items.length ? (
        <p className="muted">No saved invoices in this view.</p>
      ) : null}
      {data.next ? (
        <button
          className="secondary"
          disabled={pending}
          onClick={() => {
            setCursor(data.next);
            setPending(true);
          }}
        >
          Load 50 older completed invoices
        </button>
      ) : null}
    </section>
  );
}
