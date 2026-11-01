import { useState } from 'react';
import { z } from 'zod';
import {
  Alert,
  ErrorMessage,
  PageHeading,
  SkeletonTable,
} from '../../components/ui';
import { api, okSchema } from '../../lib/api';
import { useConfirmation } from '../../components/confirmation-context';
import { ScrollList, VirtualBody } from '../../components/scroll-list';
import { useInfiniteQuery } from '../../lib/infinite-query';
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
  const confirm = useConfirmation();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(false);
  const list = useInfiniteQuery('/manage/files', fileList, reload);
  const items = list.items;
  async function remove(id: string) {
    if (
      !(await confirm({
        title: 'Delete private file?',
        message: `Permanently delete ${items.find((item) => item.id === id)?.filename ?? 'this file'}? Any linked payment proof or invoice image will be removed from the app too. This cannot be undone.`,
        action: 'Delete file',
        destructive: true,
      }))
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
        {list.loading && items.length === 0 ? (
          <SkeletonTable
            rows={4}
            columns={4}
            headers={['File', 'Purpose', 'Size', 'Actions']}
          />
        ) : (
          <ScrollList
            {...list.scrollProps}
            count={items.length}
            className="table-scroll"
            label="Private files"
          >
            <table className="files-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Purpose</th>
                  <th className="numeric">Size</th>
                  <th className="file-actions">Actions</th>
                </tr>
              </thead>
              <VirtualBody columns={4}>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="File" className="file-name">
                      {item.filename}
                    </td>
                    <td data-label="Purpose">{item.kind}</td>
                    <td data-label="Size" className="numeric">
                      {Math.ceil(item.size / 1024)} KB
                    </td>
                    <td data-label="Actions" className="file-actions">
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
              </VirtualBody>
            </table>
            {items.length === 0 && !list.loading ? (
              <p className="empty">No uploaded files yet.</p>
            ) : null}
          </ScrollList>
        )}
      </section>
    </>
  );
}
