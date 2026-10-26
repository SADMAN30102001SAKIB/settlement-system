import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Alert, ErrorMessage, PageHeading } from '../../components/ui';
import { api, okSchema } from '../../lib/api';
const fileList = z.object({
  next: z.object({ before: z.number(), beforeId: z.string() }).nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      filename: z.string(),
      kind: z.string(),
      size: z.number(),
      createdAt: z.number(),
    }),
  ),
});

export function Files({ refresh }: { refresh: () => Promise<void> }) {
  const [items, setItems] = useState<z.infer<typeof fileList>['items']>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(false);
  const [cursor, setCursor] = useState<z.infer<typeof fileList>['next']>(null);
  const [next, setNext] = useState<z.infer<typeof fileList>['next']>(null);
  useEffect(() => {
    const controller = new AbortController();
    const query =
      cursor === null
        ? ''
        : `?${new URLSearchParams({ before: String(cursor.before), beforeId: cursor.beforeId }).toString()}`;
    api(`/manage/files${query}`, fileList, { signal: controller.signal })
      .then((data) => {
        setItems((current) =>
          cursor === null ? data.items : [...current, ...data.items],
        );
        setNext(data.next);
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
  }, [reload, cursor]);
  async function remove(id: string) {
    if (
      !window.confirm(
        'Permanently delete this private file? Any linked payment proof or invoice image will be removed from the app too.',
      )
    )
      return;
    setPending(true);
    setError('');
    try {
      await api(`/manage/files/${id}`, okSchema, {
        method: 'DELETE',
        body: {},
      });
      setReload((value) => value + 1);
      setCursor(null);
      const kind = items.find((item) => item.id === id)?.kind;
      if (kind === 'watermark' || kind === 'signature') await refresh();
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE / PRIVATE FILES"
        title="Your documents, under control"
        description="View and remove uploaded images, including unused uploads. Files are private and require your admin session. Load older files when needed."
      />
      {error ? <Alert>{error}</Alert> : null}
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Purpose</th>
                <th>Size</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.filename}</td>
                  <td>{item.kind}</td>
                  <td>{Math.ceil(item.size / 1024)} KB</td>
                  <td>
                    <div className="actions">
                      <a
                        className="text-button"
                        href={`/api/manage/files/${item.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>
                      <button
                        className="text-button danger-text"
                        disabled={pending}
                        onClick={() => {
                          remove(item.id).catch((reason: unknown) => {
                            setError(ErrorMessage(reason));
                          });
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {next ? (
          <button
            className="secondary"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setCursor(next);
            }}
          >
            Load 200 older files
          </button>
        ) : null}
      </section>
    </>
  );
}
