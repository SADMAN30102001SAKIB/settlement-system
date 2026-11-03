import { useState } from 'react';
import { z } from 'zod';
import {
  challanFields,
  challanSchema,
  challanListSchema,
} from '../../../shared/challans';
import { lineTotal } from '../../../shared/manual-invoices';
import { parseMoney } from '@settlement/domain/money';
import { api, okSchema } from '../../lib/api';
import { useInfiniteQuery } from '../../lib/infinite-query';
import {
  today,
  dateLabel,
  amountInput,
  money,
  formText,
} from '../../lib/format';
import { useConfirmation } from '../../components/confirmation-context';
import { CatalogDialog } from '../../components/catalog-dialog';
import { ScrollList, VirtualBody } from '../../components/scroll-list';
import { Alert, ErrorMessage, Field } from '../../components/ui';
type Challan = z.infer<typeof challanSchema>;
export function Challans({
  brandId,
  brandName,
  revision = 0,
  readOnly = false,
}: {
  brandId: string;
  brandName: string;
  revision?: number;
  readOnly?: boolean;
}) {
  const [refresh, setRefresh] = useState(0),
    [opened, setOpened] = useState(false),
    [editing, setEditing] = useState<Challan | null>(null);
  const [quantity, setQuantity] = useState(''),
    [cost, setCost] = useState(''),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const confirm = useConfirmation();
  const list = useInfiniteQuery(
    readOnly ? '/portal/challans' : `/manage/challans?brandId=${brandId}`,
    challanListSchema,
    `${String(revision)}:${String(refresh)}`,
  );
  function edit(item: Challan | null) {
    setEditing(item);
    setQuantity(item ? amountInput(item.quantityMilli) : '');
    setCost(item ? amountInput(item.unitCost) : '');
    setRequestId(crypto.randomUUID());
    setError('');
    setOpened(true);
  }
  async function remove(item: Challan) {
    if (
      !(await confirm({
        title: 'Delete delivery challan?',
        message: `Delete the supply record for ${brandName} on ${dateLabel(item.date)} (${money(item.total)})? Payments, invoices and balances will not change.`,
        action: 'Delete challan',
        destructive: true,
      }))
    )
      return;
    setPending(true);
    setError('');
    try {
      await api(`/manage/challans/${item.id}`, okSchema, {
        method: 'DELETE',
        body: { revision: item.revision },
      });
      setRefresh((v) => v + 1);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  let total = '—';
  try {
    total = money(
      lineTotal({
        quantityMilli: parseMoney(quantity),
        price: parseMoney(cost),
      }),
    );
  } catch {
    /* Incomplete draft. */
  }
  return (
    <section className="panel challan-panel">
      <div className="section-heading challan-heading">
        <div>
          <h2>Delivery challans</h2>
          <p className="caption">
            Supply records only. These do not change payments or balances.
          </p>
        </div>
        <div className="actions">
          <button
            className="secondary compact"
            disabled={list.loading || pending}
            onClick={() => {
              setRefresh((v) => v + 1);
            }}
          >
            Refresh challans
          </button>
          {!readOnly ? (
            <button
              className="primary compact"
              onClick={() => {
                edit(null);
              }}
              disabled={pending}
            >
              Add challan
            </button>
          ) : null}
        </div>
      </div>
      {error && !opened ? <Alert>{error}</Alert> : null}
      <ScrollList
        {...list.scrollProps}
        count={list.items.length}
        label="Delivery challan history"
        className="table-scroll"
      >
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th className="numeric">Quantity</th>
              <th className="numeric">Unit cost</th>
              <th className="numeric">Total cost</th>
              {!readOnly ? <th>Actions</th> : null}
            </tr>
          </thead>
          <VirtualBody columns={readOnly ? 4 : 5}>
            {list.items.map((item) => (
              <tr key={item.id}>
                <td data-label="Date">{dateLabel(item.date)}</td>
                <td className="numeric" data-label="Quantity">
                  {amountInput(item.quantityMilli)}
                </td>
                <td className="numeric" data-label="Unit cost">
                  {money(item.unitCost)}
                </td>
                <td className="numeric" data-label="Total cost">
                  {money(item.total)}
                </td>
                {!readOnly ? (
                  <td data-label="Actions">
                    <div className="actions">
                      <button
                        className="secondary compact"
                        disabled={pending}
                        onClick={() => {
                          edit(item);
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
                  </td>
                ) : null}
              </tr>
            ))}
            {!list.loading && !list.error && !list.items.length ? (
              <tr>
                <td colSpan={readOnly ? 4 : 5}>
                  No delivery challans recorded.
                </td>
              </tr>
            ) : null}
          </VirtualBody>
        </table>
      </ScrollList>
      {opened ? (
        <CatalogDialog
          title={editing ? 'Edit delivery challan' : 'Add delivery challan'}
          pending={pending}
          onClose={() => {
            setOpened(false);
          }}
        >
          <form
            className="panel"
            onSubmit={(event) => {
              event.preventDefault();
              setError('');
              try {
                const data = new FormData(event.currentTarget),
                  body = challanFields.parse({
                    date: formText(data, 'date'),
                    quantityMilli: parseMoney(quantity),
                    unitCost: parseMoney(cost),
                  });
                setPending(true);
                api(
                  `/manage/challans${editing ? `/${editing.id}` : ''}`,
                  z.object({ item: challanSchema }),
                  {
                    method: editing ? 'PUT' : 'POST',
                    body: {
                      ...body,
                      ...(editing
                        ? { revision: editing.revision }
                        : { requestId, brandId }),
                    },
                  },
                )
                  .then(() => {
                    setOpened(false);
                    setRefresh((v) => v + 1);
                  })
                  .catch((reason: unknown) => {
                    setError(ErrorMessage(reason));
                  })
                  .finally(() => {
                    setPending(false);
                  });
              } catch (reason) {
                setError(
                  reason instanceof z.ZodError
                    ? (reason.issues[0]?.message ?? 'Check the challan fields.')
                    : ErrorMessage(reason),
                );
              }
            }}
          >
            <p className="caption">{brandName}</p>
            <div className="form-grid">
              <Field label="Challan date">
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={editing?.date ?? today()}
                  disabled={pending}
                />
              </Field>
              <Field label="Challan quantity">
                <input
                  inputMode="decimal"
                  required
                  value={quantity}
                  disabled={pending}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                  }}
                />
              </Field>
              <Field label="Challan unit cost (৳)">
                <input
                  inputMode="decimal"
                  required
                  value={cost}
                  disabled={pending}
                  onChange={(e) => {
                    setCost(e.target.value);
                  }}
                />
              </Field>
              <Field label="Challan total cost">
                <output>{total}</output>
              </Field>
            </div>
            {error ? <Alert>{error}</Alert> : null}
            <button className="primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save challan'}
            </button>
          </form>
        </CatalogDialog>
      ) : null}
    </section>
  );
}
