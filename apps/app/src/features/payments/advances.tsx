import { useRef, useState } from 'react';
import type { z } from 'zod';
import type { advanceSchema } from '../../../shared/advances';
import { advanceListSchema } from '../../../shared/advances';
import type { Settings } from '../../lib/api';
import { api, okSchema } from '../../lib/api';
import { parseMoney } from '@settlement/domain/money';
import { formText, today, dateLabel, money } from '../../lib/format';
import { useInfiniteQuery } from '../../lib/infinite-query';
import { Alert, ErrorMessage, Field } from '../../components/ui';
import { CatalogDialog } from '../../components/catalog-dialog';
import { ScrollList, VirtualItems } from '../../components/scroll-list';
import { DocumentPaper } from '../../components/document-paper';
import { downloadDocument } from '../../lib/pdf';
type Advance = z.infer<typeof advanceSchema>;
export function Advances({
  brandId,
  brandName,
  settings,
  version = 0,
  revision = 0,
  readOnly = false,
  onSaved,
}: {
  brandId: string;
  brandName: string;
  settings: Settings;
  version?: number;
  revision?: number;
  readOnly?: boolean;
  onSaved?: () => void;
}) {
  const list = useInfiniteQuery(
    readOnly ? '/portal/advances' : `/manage/advances?brandId=${brandId}`,
    advanceListSchema,
    revision,
  );
  const [mode, setMode] = useState<'add' | 'reverse' | null>(null),
    [selected, setSelected] = useState<Advance | null>(null),
    [view, setView] = useState<Advance | null>(null),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const paper = useRef<HTMLDivElement>(null);
  return (
    <section className="panel advance-panel">
      <div className="section-heading">
        <div>
          <h2>Advance payments</h2>
          <p className="caption">
            Money received before an invoice is paid. Applying it later does not
            record new money.
          </p>
        </div>
        {!readOnly ? (
          <button
            className="primary"
            disabled={pending}
            onClick={() => {
              setMode('add');
              setError('');
            }}
          >
            Record advance
          </button>
        ) : null}
      </div>
      {error && !mode ? <Alert>{error}</Alert> : null}
      <ScrollList
        {...list.scrollProps}
        count={list.items.length}
        label="Advance payment history"
      >
        <VirtualItems
          entries={list.items.map((item) => ({
            key: item.id,
            render: () => (
              <article className="brand-row document-row">
                <div>
                  <strong>{money(item.amount)}</strong>
                  <small>
                    {dateLabel(item.date)} · {item.method} ·{' '}
                    {item.reversedAt === null ? 'Recorded' : 'Reversed'}
                  </small>
                  <small>{item.note}</small>
                </div>
                <div className="actions">
                  <button
                    className="secondary compact"
                    onClick={() => {
                      setView(item);
                    }}
                  >
                    View / PDF
                  </button>
                  {!readOnly && item.reversedAt === null ? (
                    <button
                      className="secondary compact danger-text"
                      disabled={pending}
                      onClick={() => {
                        setSelected(item);
                        setMode('reverse');
                        setError('');
                      }}
                    >
                      Reverse
                    </button>
                  ) : null}
                </div>
              </article>
            ),
          }))}
        />
      </ScrollList>
      {!list.loading && !list.items.length ? (
        <p className="muted">No advance payments recorded.</p>
      ) : null}
      {mode ? (
        <CatalogDialog
          title={
            mode === 'add'
              ? 'Record advance payment'
              : 'Reverse advance payment'
          }
          pending={pending}
          onClose={() => {
            setMode(null);
          }}
        >
          <form
            className="panel"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setPending(true);
              setError('');
              try {
                const task =
                  mode === 'add'
                    ? api('/manage/advances', okSchema, {
                        method: 'POST',
                        body: {
                          requestId,
                          brandId,
                          date: formText(data, 'date'),
                          amount: parseMoney(formText(data, 'amount')),
                          method: formText(data, 'method'),
                          reference: formText(data, 'reference'),
                          note: formText(data, 'note'),
                        },
                      })
                    : api(
                        `/manage/advances/${selected?.id ?? ''}/reverse`,
                        okSchema,
                        {
                          method: 'POST',
                          body: { version, reason: formText(data, 'reason') },
                        },
                      );
                task
                  .then(() => {
                    setMode(null);
                    setRequestId(crypto.randomUUID());
                    list.refresh();
                    onSaved?.();
                  })
                  .catch((e: unknown) => {
                    setError(ErrorMessage(e));
                  })
                  .finally(() => {
                    setPending(false);
                  });
              } catch (e) {
                setError(ErrorMessage(e));
                setPending(false);
              }
            }}
          >
            {mode === 'add' ? (
              <>
                <Field label="Advance amount (৳)">
                  <input name="amount" inputMode="decimal" required />
                </Field>
                <Field label="Advance date">
                  <input
                    name="date"
                    type="date"
                    defaultValue={today()}
                    required
                  />
                </Field>
                <Field label="Payment method">
                  <select name="method">
                    {['Cash', 'Bank transfer', 'bKash', 'Nagad', 'Other'].map(
                      (method) => (
                        <option key={method}>{method}</option>
                      ),
                    )}
                  </select>
                </Field>
                <Field label="Reference (optional)">
                  <input name="reference" maxLength={100} />
                </Field>
                <Field label="Advance note (optional)">
                  <input name="note" maxLength={200} />
                </Field>
              </>
            ) : (
              <>
                <p>
                  Reverse {money(selected?.amount ?? 0)}? This requires
                  sufficient unused credit. If it was applied to invoices,
                  reverse those applications first. History will be retained.
                </p>
                <Field label="Reversal reason">
                  <textarea
                    name="reason"
                    required
                    minLength={5}
                    maxLength={200}
                  />
                </Field>
              </>
            )}
            {error ? <Alert>{error}</Alert> : null}
            <button
              className={mode === 'add' ? 'primary' : 'secondary danger-text'}
              disabled={pending}
            >
              {pending
                ? 'Saving…'
                : mode === 'add'
                  ? 'Save advance'
                  : 'Confirm reversal'}
            </button>
          </form>
        </CatalogDialog>
      ) : null}
      {view ? (
        <CatalogDialog
          title="Advance payment receipt"
          pending={pending}
          wide
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
                downloadDocument(document, `ADV-${view.id}`)
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
          </div>
          <div ref={paper}>
            <DocumentPaper
              title={
                view.reversedAt === null
                  ? 'Advance payment receipt'
                  : 'REVERSED ADVANCE RECEIPT'
              }
              number={`ADV-${view.id}`}
              date={view.date}
              recipient={brandName}
              settings={settings}
              fileBase={readOnly ? '/api/portal/files' : '/api/manage/files'}
              lines={[
                {
                  description: 'Advance received — not an invoice payment',
                  quantityMilli: 1000,
                  price: view.amount,
                },
              ]}
              total={view.amount}
              notes={`${view.method}${view.reference ? ' · ' + view.reference : ''}. ${view.note}${view.reversedAt !== null ? ' Reversed: ' + (view.reversalReason ?? '') : ''}`}
            />
          </div>
        </CatalogDialog>
      ) : null}
    </section>
  );
}
