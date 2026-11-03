import { useRef, useState } from 'react';
import { z } from 'zod';
import {
  manualFields,
  manualSchema,
  manualListSchema,
  manualTotal,
} from '../../../shared/manual-invoices';
import { parseMoney } from '@settlement/domain/money';
import { api, okSchema } from '../../lib/api';
import type { Settings } from '../../lib/api';
import {
  today,
  formText,
  amountInput,
  money,
  dateLabel,
} from '../../lib/format';
import { useInfiniteQuery } from '../../lib/infinite-query';
import { useConfirmation } from '../../components/confirmation-context';
import { CatalogDialog } from '../../components/catalog-dialog';
import { ScrollList, VirtualItems } from '../../components/scroll-list';
import { Alert, ErrorMessage, Field, PageHeading } from '../../components/ui';
import { DocumentPaper } from '../../components/document-paper';
import { downloadDocument } from '../../lib/pdf';
import { LetterEditor } from './letter-editor';
import type { JSONContent } from '@tiptap/react';
const emptyLetter: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

type Invoice = z.infer<typeof manualSchema>;
export function ManualInvoices({ settings }: { settings: Settings }) {
  const [revision, setRevision] = useState(0),
    [opened, setOpened] = useState(false),
    [editing, setEditing] = useState<Invoice | null>(null),
    [view, setView] = useState<Invoice | null>(null);
  const [lines, setLines] = useState([
    { description: '', quantity: '1', price: '' },
  ]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<'itemized' | 'letter'>('itemized');
  const [letterBody, setBody] = useState<JSONContent>(emptyLetter);
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const paper = useRef<HTMLDivElement>(null);
  const confirm = useConfirmation();
  const list = useInfiniteQuery(
    '/manage/manual-invoices',
    manualListSchema,
    revision,
  );
  function edit(item: Invoice | null) {
    setEditing(item);
    setKind(item?.kind ?? 'itemized');
    setBody(item?.body ?? emptyLetter);
    setError('');
    setLines(
      item
        ? item.lines.map((line) => ({
            description: line.description,
            quantity: amountInput(line.quantityMilli),
            price: amountInput(line.price),
          }))
        : [{ description: '', quantity: '1', price: '' }],
    );
    setRequestId(crypto.randomUUID());
    setOpened(true);
  }
  async function open(id: string, mode: 'view' | 'edit') {
    setPending(true);
    setError('');
    try {
      const result = await api(`/manage/manual-invoices/${id}`, zDetail);
      if (mode === 'edit') edit(result.item);
      else setView(result.item);
    } catch (e) {
      setError(ErrorMessage(e));
    } finally {
      setPending(false);
    }
  }
  async function remove(item: { id: string; revision: number }) {
    if (
      !(await confirm({
        title: 'Delete manual invoice?',
        message:
          'This deletes only this standalone document. Brand accounts, payments and expenses will not change.',
        action: 'Delete invoice',
        destructive: true,
      }))
    )
      return;
    setPending(true);
    try {
      await api(`/manage/manual-invoices/${item.id}`, okSchema, {
        method: 'DELETE',
        body: { revision: item.revision },
      });
      setView(null);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(ErrorMessage(e));
    } finally {
      setPending(false);
    }
  }
  let total = '—';
  try {
    total = money(
      manualTotal(
        lines.map((line) => ({
          quantityMilli: parseMoney(line.quantity),
          price: parseMoney(line.price),
        })),
      ),
    );
  } catch {
    /* Incomplete draft. */
  }
  return (
    <>
      <PageHeading
        eyebrow="DOCUMENTS / MANUAL INVOICES"
        title="Make an invoice"
        description="Standalone itemized invoices and letters. These do not change brand balances or record payments."
        action={
          <button
            className="primary"
            onClick={() => {
              edit(null);
            }}
          >
            New invoice
          </button>
        }
      />
      {error && !opened ? <Alert>{error}</Alert> : null}
      <section className="panel">
        <h2>Manual invoices</h2>
        <ScrollList
          {...list.scrollProps}
          count={list.items.length}
          label="Manual invoices"
        >
          <VirtualItems
            entries={list.items.map((item) => ({
              key: item.id,
              render: () => (
                <article className="brand-row document-row">
                  <div>
                    <strong>{item.number}</strong>
                    <small>
                      {dateLabel(item.date)} · {item.title}
                    </small>
                    <small>{item.recipient}</small>
                    {item.kind === 'itemized' ? (
                      <strong>{money(item.total)}</strong>
                    ) : (
                      <small>Letter document</small>
                    )}
                  </div>
                  <div className="actions">
                    <button
                      className="secondary compact"
                      disabled={pending}
                      onClick={() => {
                        open(item.id, 'view').catch((reason: unknown) => {
                          setError(ErrorMessage(reason));
                        });
                      }}
                    >
                      View / PDF
                    </button>
                    <button
                      className="secondary compact"
                      disabled={pending}
                      onClick={() => {
                        open(item.id, 'edit').catch((reason: unknown) => {
                          setError(ErrorMessage(reason));
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="secondary compact danger-text"
                      disabled={pending}
                      onClick={() => {
                        remove(item).catch((reason: unknown) => {
                          setError(ErrorMessage(reason));
                        });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ),
            }))}
          />
        </ScrollList>
        {!list.loading && !list.items.length ? (
          <p className="muted">No manual invoices yet.</p>
        ) : null}
      </section>
      {opened ? (
        <CatalogDialog
          title={editing ? 'Edit manual invoice' : 'New manual invoice'}
          pending={pending}
          onClose={() => {
            setOpened(false);
          }}
          wide
        >
          <form
            className="panel"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setPending(true);
              setError('');
              try {
                const body = manualFields.parse({
                  kind,
                  body: kind === 'letter' ? letterBody : null,
                  date: formText(data, 'date'),
                  title: formText(data, 'title'),
                  recipient: formText(data, 'recipient'),
                  notes: kind === 'letter' ? '' : formText(data, 'notes'),
                  stamp:
                    kind === 'letter' ? null : formText(data, 'stamp') || null,
                  lines:
                    kind === 'letter'
                      ? []
                      : lines.map((line) => ({
                          description: line.description,
                          quantityMilli: parseMoney(line.quantity),
                          price: parseMoney(line.price),
                        })),
                });
                api(
                  `/manage/manual-invoices${editing ? `/${editing.id}` : ''}`,
                  zDetail,
                  {
                    method: editing ? 'PUT' : 'POST',
                    body: {
                      ...body,
                      ...(editing
                        ? { revision: editing.revision }
                        : { requestId }),
                    },
                  },
                )
                  .then((result) => {
                    setOpened(false);
                    setView(result.item);
                    setRevision((v) => v + 1);
                  })
                  .catch((e: unknown) => {
                    setError(ErrorMessage(e));
                  })
                  .finally(() => {
                    setPending(false);
                  });
              } catch (e) {
                setError(
                  e instanceof z.ZodError
                    ? (e.issues[0]?.message ?? 'Check the document fields.')
                    : ErrorMessage(e),
                );
                setPending(false);
              }
            }}
          >
            <Field label="Document type">
              <select
                value={kind}
                disabled={pending}
                onChange={(e) => {
                  setKind(e.target.value === 'letter' ? 'letter' : 'itemized');
                }}
              >
                <option value="itemized">Itemized invoice</option>
                <option value="letter">Letter document</option>
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Document title">
                <input
                  name="title"
                  required
                  maxLength={100}
                  defaultValue={editing?.title ?? 'Invoice'}
                />
              </Field>
              <Field label="Document date">
                <input
                  type="date"
                  name="date"
                  required
                  defaultValue={editing?.date ?? today()}
                />
              </Field>
              <Field label="Prepared for (optional)">
                <input
                  name="recipient"
                  maxLength={200}
                  defaultValue={editing?.recipient ?? ''}
                />
              </Field>
              {kind === 'itemized' ? (
                <Field label="Document stamp">
                  <select name="stamp" defaultValue={editing?.stamp ?? ''}>
                    <option value="">No stamp</option>
                    {['Paid', 'Unpaid', 'Due'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </div>
            {kind === 'letter' ? (
              <LetterEditor
                value={letterBody}
                onChange={setBody}
                disabled={pending}
              />
            ) : (
              <>
                <h2>Items</h2>
                {lines.map((line, index) => (
                  <div className="manual-line" key={index}>
                    <Field label={`Item ${String(index + 1)}`}>
                      <input
                        required
                        maxLength={200}
                        value={line.description}
                        onChange={(e) => {
                          setLines((current) =>
                            current.map((v, i) =>
                              i === index
                                ? { ...v, description: e.target.value }
                                : v,
                            ),
                          );
                        }}
                      />
                    </Field>
                    <Field label={`Quantity ${String(index + 1)}`}>
                      <input
                        inputMode="decimal"
                        required
                        value={line.quantity}
                        onChange={(e) => {
                          setLines((current) =>
                            current.map((v, i) =>
                              i === index
                                ? { ...v, quantity: e.target.value }
                                : v,
                            ),
                          );
                        }}
                      />
                    </Field>
                    <Field label={`Unit price ${String(index + 1)} (৳)`}>
                      <input
                        inputMode="decimal"
                        required
                        value={line.price}
                        onChange={(e) => {
                          setLines((current) =>
                            current.map((v, i) =>
                              i === index ? { ...v, price: e.target.value } : v,
                            ),
                          );
                        }}
                      />
                    </Field>
                    <button
                      type="button"
                      className="secondary compact danger-text"
                      disabled={lines.length === 1 || pending}
                      onClick={() => {
                        setLines((current) =>
                          current.filter((_, i) => i !== index),
                        );
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={lines.length >= 50 || pending}
                    onClick={() => {
                      setLines((current) => [
                        ...current,
                        { description: '', quantity: '1', price: '' },
                      ]);
                    }}
                  >
                    Add item
                  </button>
                  <strong>Total {total}</strong>
                </div>
                <Field label="Notes (optional)">
                  <textarea
                    name="notes"
                    maxLength={2000}
                    defaultValue={editing?.notes ?? ''}
                  />
                </Field>
              </>
            )}
            {error ? <Alert>{error}</Alert> : null}
            <button className="primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save invoice'}
            </button>
          </form>
        </CatalogDialog>
      ) : null}
      {view ? (
        <CatalogDialog
          title="Manual invoice preview"
          wide
          pending={pending}
          onClose={() => {
            setView(null);
          }}
        >
          {error ? <Alert>{error}</Alert> : null}
          <div className="panel actions no-print">
            <button
              className="primary"
              disabled={pending}
              onClick={() => {
                const document =
                  paper.current?.querySelector<HTMLElement>(
                    '.invoice-document',
                  );
                if (!document) return;
                setPending(true);
                downloadDocument(document, view.number)
                  .catch((e: unknown) => {
                    setError(ErrorMessage(e));
                  })
                  .finally(() => {
                    setPending(false);
                  });
              }}
            >
              Download PDF
            </button>
            <button
              className="secondary"
              onClick={() => {
                window.print();
              }}
            >
              Print
            </button>
            <button
              className="secondary"
              onClick={() => {
                edit(view);
                setView(null);
              }}
            >
              Edit
            </button>
          </div>
          <div ref={paper}>
            <DocumentPaper {...view} settings={settings} />
          </div>
        </CatalogDialog>
      ) : null}
    </>
  );
}
const zDetail = z.object({ item: manualSchema });
