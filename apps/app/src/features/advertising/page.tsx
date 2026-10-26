import { useEffect, useState } from 'react';
import { useConfirmation } from '../../components/confirmation-context';
import type { SubmitEvent } from 'react';
import { z } from 'zod';
import { parseMoney, sumMoney } from '@settlement/domain/money';
import { paymentStatus } from '@settlement/domain/payments';

import {
  Alert,
  Empty,
  ErrorMessage,
  Field,
  Metric,
  PageHeading,
} from '../../components/ui';
import { api, adAccountSchema, adDetailSchema, okSchema } from '../../lib/api';
import type { AdInvoice, Brand, Settings } from '../../lib/api';
import { amountInput, dateLabel, money, today } from '../../lib/format';
import { Invoice } from '../settlements/invoice';
import { PaymentsPanel } from '../payments/panel';
const accountOverviewSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      count: z.number(),
      total: z.number(),
      paid: z.number(),
    }),
  ),
});

function Editor({
  item,
  brands,
  onSaved,
  onBack,
}: {
  item: AdInvoice | null;
  brands: Brand[];
  onSaved: (id: string) => void;
  onBack: () => void;
}) {
  const [brandId, setBrandId] = useState(item?.brandId ?? '');
  const [date, setDate] = useState(item?.date ?? today());
  const [period, setPeriod] = useState(item?.period ?? '');
  const [lines, setLines] = useState(
    item?.campaigns.map((line) => ({
      key: crypto.randomUUID(),
      name: line.name,
      amount: amountInput(line.amount),
    })) ?? [{ key: crypto.randomUUID(), name: '', amount: '' }],
  );
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  let total = 0;
  try {
    total = sumMoney(lines.map((line) => parseMoney(line.amount || '0')));
  } catch {
    total = 0;
  }
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const saved = await api(
        `/manage/advertising${item ? `/${item.id}` : ''}`,
        z.object({ id: z.string() }),
        {
          method: item ? 'PUT' : 'POST',
          body: {
            brandId,
            date,
            period,
            campaigns: lines.map((line) => ({
              name: line.name,
              amount: parseMoney(line.amount),
            })),
            ...(item ? { revision: item.revision } : {}),
          },
        },
      );
      onSaved(saved.id);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="ADVERTISING / EDITOR"
        title={
          item ? 'Edit advertising invoice' : 'Every campaign, accounted for'
        }
        description="Save a brand’s campaign-wise advertising costs for the period."
        action={
          <button className="secondary" onClick={onBack}>
            Back
          </button>
        }
      />
      <form
        className="panel"
        onSubmit={(event) => {
          save(event).catch((reason: unknown) => {
            setError(ErrorMessage(reason));
          });
        }}
        onChange={() => {
          setError('');
        }}
      >
        <div className="form-grid">
          <Field label="Brand">
            <select
              value={brandId}
              disabled={item !== null}
              required
              onChange={(event) => {
                setBrandId(event.target.value);
              }}
            >
              <option value="">Choose brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Invoice date">
            <input
              type="date"
              required
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
              }}
            />
          </Field>
          <Field label="Period">
            <input
              required
              maxLength={120}
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value);
              }}
              placeholder="e.g. 01–07 October 2026"
            />
          </Field>
        </div>
        <h2>Campaigns</h2>
        {lines.map((line, index) => (
          <div className="campaign-row" key={line.key}>
            <Field label={`Campaign ${String(index + 1)}`}>
              <input
                required
                maxLength={80}
                value={line.name}
                onChange={(event) => {
                  setLines((current) =>
                    current.map((value) =>
                      value.key === line.key
                        ? { ...value, name: event.target.value }
                        : value,
                    ),
                  );
                }}
              />
            </Field>
            <Field label="Amount (৳)">
              <input
                required
                inputMode="decimal"
                value={line.amount}
                onChange={(event) => {
                  setLines((current) =>
                    current.map((value) =>
                      value.key === line.key
                        ? { ...value, amount: event.target.value }
                        : value,
                    ),
                  );
                }}
              />
            </Field>
            <button
              type="button"
              className="secondary compact"
              disabled={lines.length === 1 || pending}
              onClick={() => {
                setLines((current) =>
                  current.filter((value) => value.key !== line.key),
                );
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="section-heading">
          <button
            type="button"
            className="secondary"
            disabled={lines.length >= 50 || pending}
            onClick={() => {
              setLines((current) => [
                ...current,
                { key: crypto.randomUUID(), name: '', amount: '' },
              ]);
            }}
          >
            + Add campaign
          </button>
          <strong>Total {money(total)}</strong>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <button className="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save invoice'}
        </button>
      </form>
    </>
  );
}

function Detail({
  id,
  edit,
  brands,
  settings,
  navigate,
}: {
  id: string;
  edit: boolean;
  brands: Brand[];
  settings: Settings;
  navigate: (path: string) => void;
}) {
  const confirm = useConfirmation();
  const [data, setData] = useState<z.infer<typeof adDetailSchema> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api(`/manage/advertising/${id}`, adDetailSchema, {
      signal: controller.signal,
    })
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      });
    return () => {
      controller.abort();
    };
  }, [id]);
  if (data === null)
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p role="status">Loading invoice…</p>
    );
  async function remove() {
    if (
      data === null ||
      !(await confirm({
        title: 'Delete advertising invoice?',
        message: `Delete ${data.item.invoiceNumber} and its direct payments? Account payments will be reallocated to the remaining invoices.`,
        action: 'Delete invoice',
        destructive: true,
      }))
    )
      return;
    try {
      await api(`/manage/advertising/${id}`, okSchema, {
        method: 'DELETE',
        body: { revision: data.item.revision },
      });
      navigate('/advertising');
    } catch (reason) {
      setError(ErrorMessage(reason));
    }
  }
  if (edit)
    return (
      <Editor
        item={data.item}
        brands={brands}
        onSaved={(key) => {
          navigate(`/advertising/${key}`);
        }}
        onBack={() => {
          navigate(`/advertising/${id}`);
        }}
      />
    );
  return (
    <>
      {error ? <Alert>{error}</Alert> : null}
      <Invoice
        report={data.item}
        settings={settings}
        onEdit={() => {
          navigate(`/advertising/${id}/edit`);
        }}
        onBack={() => {
          navigate('/advertising');
        }}
        onDelete={() => {
          remove().catch((reason: unknown) => {
            setError(ErrorMessage(reason));
          });
        }}
      />
      <PaymentsPanel
        target={{ kind: 'ads', targetId: id }}
        total={data.item.total}
        paid={data.item.paid}
        payments={data.payments}
        refresh={async () => {
          setData(await api(`/manage/advertising/${id}`, adDetailSchema));
        }}
      />
      <div className="no-print">
        <p className="muted">
          Paid includes account payments allocated oldest-first. History above
          shows payments recorded directly on this invoice.
        </p>
      </div>
    </>
  );
}

export function Advertising({
  path,
  brands,
  settings,
  navigate,
}: {
  path: string;
  brands: Brand[];
  settings: Settings;
  navigate: (path: string) => void;
}) {
  const [brandId, setBrandId] = useState(brands[0]?.id ?? '');
  const [data, setData] = useState<z.infer<typeof adAccountSchema> | null>(
    null,
  );
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [overview, setOverview] = useState<
    z.infer<typeof accountOverviewSchema>['items']
  >([]);
  const parts = path.split('/');
  const listing = !parts[2];
  async function reloadAccount() {
    const [account, all] = await Promise.all([
      api(`/manage/advertising/account/${brandId}`, adAccountSchema),
      api('/manage/advertising/overview', accountOverviewSchema),
    ]);
    setData(account);
    setOverview(all.items);
    setError('');
  }
  useEffect(() => {
    if (!listing) return;
    const controller = new AbortController();
    api('/manage/advertising/overview', accountOverviewSchema, {
      signal: controller.signal,
    })
      .then((result) => {
        setOverview(result.items);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      });
    return () => {
      controller.abort();
    };
  }, [listing]);
  useEffect(() => {
    if (!listing || !brandId) return;
    const controller = new AbortController();
    api(`/manage/advertising/account/${brandId}`, adAccountSchema, {
      signal: controller.signal,
    })
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      });
    return () => {
      controller.abort();
    };
  }, [brandId, listing]);
  if (parts[2] === 'new')
    return (
      <Editor
        item={null}
        brands={brands}
        onSaved={(id) => {
          navigate(`/advertising/${id}`);
        }}
        onBack={() => {
          navigate('/advertising');
        }}
      />
    );
  if (parts[2])
    return (
      <Detail
        key={path}
        id={parts[2]}
        edit={parts[3] === 'edit'}
        brands={brands}
        settings={settings}
        navigate={navigate}
      />
    );
  return (
    <>
      <PageHeading
        eyebrow="ADVERTISING / ACCOUNTS"
        title="Spend clearly. Settle confidently."
        description="Brand accounts automatically apply payments to the oldest unpaid advertising invoice, preserving advances."
        action={
          <button
            className="primary"
            onClick={() => {
              navigate('/advertising/new');
            }}
          >
            + New advertising invoice
          </button>
        }
      />
      <section className="panel">
        <h2>Brand accounts · all dates</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Brand</th>
                <th>Invoices</th>
                <th>Advertising cost</th>
                <th>Total paid</th>
                <th>Due / advance</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {overview.map((account) => (
                <tr key={account.id}>
                  <td>{account.name}</td>
                  <td>{account.count}</td>
                  <td>{money(account.total)}</td>
                  <td>{money(account.paid)}</td>
                  <td>
                    {money(Math.abs(account.total - account.paid))}{' '}
                    {account.paid > account.total
                      ? 'Advance'
                      : account.paid === account.total
                        ? 'Settled'
                        : 'Due'}
                  </td>
                  <td>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        if (brandId !== account.id) {
                          setBrandId(account.id);
                          setData(null);
                        }
                      }}
                    >
                      Open account
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="form-grid">
          <Field label="Brand account">
            <select
              value={brandId}
              onChange={(event) => {
                setBrandId(event.target.value);
                setData(null);
                setError('');
              }}
            >
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Search invoices">
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Invoice or period"
            />
          </Field>
          <Field label="Invoice date from">
            <input
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
            />
          </Field>
          <Field label="Invoice date to">
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => {
                setTo(event.target.value);
              }}
            />
          </Field>
        </div>
      </section>
      {error ? <Alert>{error}</Alert> : null}
      {brandId ? (
        <button
          className="secondary"
          onClick={() => {
            reloadAccount().catch((reason: unknown) => {
              setError(ErrorMessage(reason));
            });
          }}
        >
          Reload account
        </button>
      ) : null}
      {!brandId ? (
        <Empty title="Add your first brand">
          Create a brand before recording advertising costs.
        </Empty>
      ) : data === null ? (
        <p role="status">Loading account…</p>
      ) : (
        <>
          <div className="metrics">
            <Metric
              label="Advertising invoices"
              value={String(data.invoices.length)}
            />
            <Metric label="Total advertising cost" value={money(data.total)} />
            <Metric label="Total paid" value={money(data.paid)} />
            <Metric
              label={data.paid > data.total ? 'Account advance' : 'Account due'}
              value={money(Math.abs(data.total - data.paid))}
            />
          </div>
          <section className="panel">
            <h2>Invoice ledger</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Invoice / date</th>
                    <th>Period</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices
                    .filter(
                      (item) =>
                        (!from || item.date >= from) &&
                        (!to || item.date <= to),
                    )
                    .filter((item) =>
                      `${item.invoiceNumber} ${item.period} ${item.date}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .sort(
                      (a, b) =>
                        b.date.localeCompare(a.date) ||
                        b.createdAt - a.createdAt,
                    )
                    .map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.invoiceNumber}
                          <small>{dateLabel(item.date)}</small>
                        </td>
                        <td>{item.period}</td>
                        <td>{money(item.total)}</td>
                        <td>{money(item.paid)}</td>
                        <td>{paymentStatus(item.total, item.paid).status}</td>
                        <td>
                          <button
                            className="secondary compact"
                            onClick={() => {
                              navigate(`/advertising/${item.id}`);
                            }}
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
          <PaymentsPanel
            key={brandId}
            target={{ kind: 'brand', targetId: brandId }}
            total={data.total}
            paid={data.paid}
            payments={data.payments}
            refresh={reloadAccount}
          />
        </>
      )}
    </>
  );
}
