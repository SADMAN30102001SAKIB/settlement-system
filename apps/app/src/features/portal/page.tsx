import { useEffect, useState } from 'react';
import { useAccountRefresh } from '../../lib/account-refresh';
import type { SubmitEvent } from 'react';
import { z } from 'zod';
import {
  brandSessionSchema,
  documentKind,
  portalListSchema,
} from '../../../shared/access';
import {
  receiptSchema,
  paymentSummarySchema,
  commissionOutstandingLabel,
} from '../../../shared/receipts';
import {
  api,
  okSchema,
  settingsSchema,
  reportSchema,
  adDetailSchema,
  BRAND_SESSION_EXPIRED_EVENT,
} from '../../lib/api';
import type { Settings } from '../../lib/api';
import { useInfiniteQuery } from '../../lib/infinite-query';
import { formText, dateLabel, money } from '../../lib/format';
import {
  Alert,
  ErrorMessage,
  Field,
  Spinner,
  Metric,
  SkeletonMetrics,
} from '../../components/ui';
import { PasswordField } from '../../components/password-field';
import { ThemePicker } from '../../components/theme-picker';
import { ScrollList, VirtualBody } from '../../components/scroll-list';
import { CatalogDialog } from '../../components/catalog-dialog';
import { Invoice } from '../settlements/invoice';
import { ReceiptView } from '../payments/receipt';

type BrandSession = z.infer<typeof brandSessionSchema>['brand'];
const labels = {
  settlements: 'Settlement invoices',
  advertising: 'Advertising invoices',
  receipts: 'Payment receipts',
};
const detailSchema = z.object({
  item: z.union([reportSchema, adDetailSchema.shape.item, receiptSchema]),
});

function PortalDocument({
  kind,
  id,
  settings,
  onClose,
}: {
  kind: z.infer<typeof documentKind>;
  id: string;
  settings: Settings;
  onClose: () => void;
}) {
  const [item, setItem] = useState<z.infer<typeof detailSchema>['item'] | null>(
      null,
    ),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api(`/portal/invoices/${kind}/${id}`, detailSchema, {
      signal: controller.signal,
    })
      .then((data) => {
        setItem(data.item);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      });
    return () => {
      controller.abort();
    };
  }, [kind, id]);
  return (
    <CatalogDialog
      wide
      title="Invoice preview"
      pending={false}
      onClose={onClose}
    >
      <div className="portal-document-content">
        {error ? (
          <Alert>{error}</Alert>
        ) : !item ? (
          <p role="status">
            <Spinner size={12} />
            Loading invoice…
          </p>
        ) : 'data' in item ? (
          <ReceiptView
            item={item}
            settings={settings}
            readOnly
            fileBase="/api/portal/files"
            onBack={onClose}
          />
        ) : (
          <Invoice
            report={item}
            settings={settings}
            readOnly
            fileBase="/api/portal/files"
            onBack={onClose}
          />
        )}
      </div>
    </CatalogDialog>
  );
}

function PaymentSummary({ revision }: { revision: number }) {
  const [item, setItem] = useState<z.infer<typeof paymentSummarySchema> | null>(
    null,
  );
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api('/portal/payment-summary', paymentSummarySchema, {
      signal: controller.signal,
    })
      .then((result) => {
        setItem(result);
        setError('');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      });
    return () => {
      controller.abort();
    };
  }, [retry, revision]);
  return (
    <section className="portal-payment-summary" aria-label="Payment balances">
      {error ? (
        <Alert>
          {error}
          <button
            className="secondary compact"
            onClick={() => {
              setError('');
              setRetry((value) => value + 1);
            }}
          >
            Retry balances
          </button>
        </Alert>
      ) : !item ? (
        <SkeletonMetrics count={4} />
      ) : (
        <div className="metrics">
          <Metric
            label={commissionOutstandingLabel(item.commissionBasisPoints)}
            value={money(item.commission.due)}
          />
          <Metric
            label="Advertising outstanding with VAT"
            value={money(item.ads.due)}
          />
          <Metric
            label="Commission payments received"
            value={money(item.commission.paid)}
          />
          <Metric
            label="Advertising payments received"
            value={money(item.ads.paid)}
          />
          <Metric
            label="Advance payments received"
            value={money(item.advance.received)}
          />
          <Metric
            label="Available advance"
            value={money(item.advance.balance)}
          />
          <Metric
            label="Total due"
            value={money(item.commission.due + item.ads.due)}
          />
          <Metric
            label="Total money received"
            value={money(item.totalReceived)}
          />
        </div>
      )}
    </section>
  );
}

function BrandDashboard({ brand }: { brand: NonNullable<BrandSession> }) {
  const [kind, setKind] = useState<z.infer<typeof documentKind>>(() => {
    const value = documentKind.safeParse(
      new URLSearchParams(window.location.search).get('type'),
    );
    return value.success ? value.data : 'settlements';
  });
  const [settings, setSettings] = useState<Settings | null>(null),
    [summaryRevision, setSummaryRevision] = useState(0),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<{
      kind: z.infer<typeof documentKind>;
      id: string;
    } | null>(null);
  const list = useInfiniteQuery(
    `/portal/invoices?kind=${kind}`,
    portalListSchema,
    summaryRevision,
  );
  useAccountRefresh(setSummaryRevision);
  useEffect(() => {
    const controller = new AbortController();
    api('/portal/settings', z.object({ item: settingsSchema }), {
      signal: controller.signal,
    })
      .then((data) => {
        setSettings(data.item);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      });
    return () => {
      controller.abort();
    };
  }, []);
  function choose(value: z.infer<typeof documentKind>) {
    setKind(value);
    window.history.replaceState(null, '', `/brand?type=${value}`);
  }
  return (
    <main className="brand-portal-main">
      <header className="portal-intro">
        <p className="eyebrow">YOUR BRAND / YOUR DOCUMENTS</p>
        <h1>{brand.name}</h1>
        <p className="muted">
          View your invoices and download their PDFs. Everything here belongs to
          your brand.
        </p>
      </header>
      <div
        className="portal-tabs"
        role="tablist"
        tabIndex={-1}
        aria-label="Invoice categories"
        onKeyDown={(event) => {
          const index = documentKind.options.indexOf(kind);
          const next =
            event.key === 'ArrowRight'
              ? (index + 1) % 3
              : event.key === 'ArrowLeft'
                ? (index + 2) % 3
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 2
                    : -1;
          if (next < 0) return;
          event.preventDefault();
          const value = documentKind.options[next];
          if (value) {
            choose(value);
            event.currentTarget
              .querySelector<HTMLButtonElement>(`[id="portal-tab-${value}"]`)
              ?.focus();
          }
        }}
      >
        {documentKind.options.map((value) => (
          <button
            key={value}
            id={`portal-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={kind === value}
            aria-controls="portal-invoices"
            tabIndex={kind === value ? 0 : -1}
            className={kind === value ? 'primary' : 'secondary'}
            onClick={() => {
              choose(value);
            }}
          >
            {labels[value]}
          </button>
        ))}
      </div>
      {error ? (
        <Alert>
          {error}
          <button
            className="secondary"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload documents
          </button>
        </Alert>
      ) : null}
      <section
        className="panel portal-invoices"
        id="portal-invoices"
        role="tabpanel"
        aria-labelledby={`portal-tab-${kind}`}
      >
        <div className="section-heading">
          <h2>{labels[kind]}</h2>
          <button
            className="secondary compact"
            disabled={list.loading}
            onClick={() => {
              setSummaryRevision((value) => value + 1);
            }}
          >
            Refresh
          </button>
        </div>
        {kind === 'receipts' ? (
          <PaymentSummary revision={summaryRevision} />
        ) : null}
        <ScrollList
          {...list.scrollProps}
          count={list.items.length}
          className="table-scroll"
          label={labels[kind]}
        >
          <table className="portal-invoice-table">
            <thead>
              <tr>
                <th>Invoice / date</th>
                <th>Period</th>
                <th>Document</th>
              </tr>
            </thead>
            <VirtualBody columns={3}>
              {list.items.map((row) => (
                <tr key={row.id}>
                  <td data-label="Invoice / date">
                    <strong>{row.number}</strong>
                    <small>{dateLabel(row.date)}</small>
                  </td>
                  <td data-label="Period">{row.period}</td>
                  <td data-label="Document">
                    <button
                      className="secondary compact"
                      disabled={!settings}
                      onClick={() => {
                        setSelected({ kind, id: row.id });
                      }}
                    >
                      View invoice
                    </button>
                  </td>
                </tr>
              ))}
            </VirtualBody>
          </table>
          {!list.loading && !list.items.length && !list.error ? (
            <p className="portal-empty">
              No {labels[kind].toLowerCase()} have been shared with your brand
              yet.
            </p>
          ) : null}
        </ScrollList>
      </section>
      {selected && settings ? (
        <PortalDocument
          key={selected.kind + selected.id}
          {...selected}
          settings={settings}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </main>
  );
}

export function BrandPortal() {
  const [loaded, setLoaded] = useState(false),
    [brand, setBrand] = useState<BrandSession>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api('/brand-auth/status', brandSessionSchema, { signal: controller.signal })
      .then((data) => {
        setBrand(data.brand);
        setLoaded(true);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(ErrorMessage(reason));
          setLoaded(true);
        }
      });
    const expired = () => {
      setBrand(null);
      setError('Your session ended. Please sign in again.');
    };
    window.addEventListener(BRAND_SESSION_EXPIRED_EVENT, expired);
    return () => {
      controller.abort();
      window.removeEventListener(BRAND_SESSION_EXPIRED_EVENT, expired);
    };
  }, []);
  async function login(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api('/brand-auth/login', brandSessionSchema, {
        method: 'POST',
        body: {
          username: formText(form, 'username'),
          password: formText(form, 'password'),
        },
      });
      setBrand(result.brand);
      window.history.replaceState(null, '', '/brand');
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  async function logout() {
    setPending(true);
    setError('');
    try {
      await api('/brand-auth/logout', okSchema, { method: 'POST', body: {} });
      setBrand(null);
      window.history.replaceState(null, '', '/brand/login');
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="brand-portal">
      <header className="portal-header no-print">
        <a href="/brand" className="wordmark">
          <span className="brand-mark">H</span>HEXA <small>BRAND PORTAL</small>
        </a>
        <div className="actions">
          <ThemePicker />
          {brand ? (
            <button
              className="secondary compact"
              disabled={pending}
              onClick={() => {
                logout().catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                });
              }}
            >
              Sign out
            </button>
          ) : (
            <a className="secondary compact" href="/">
              Admin sign-in
            </a>
          )}
        </div>
      </header>
      {!loaded ? (
        <main className="brand-portal-main">
          <p role="status">
            <Spinner size={12} />
            Opening brand portal…
          </p>
        </main>
      ) : brand ? (
        <>
          {error ? <Alert>{error}</Alert> : null}
          <BrandDashboard key={brand.id} brand={brand} />
        </>
      ) : (
        <main className="portal-login">
          <section className="panel">
            <p className="eyebrow">PRIVATE BRAND ACCESS</p>
            <h1>Your invoices, in one place</h1>
            <p className="muted">
              Sign in with the username and password provided by your agency.
            </p>
            <form
              onSubmit={(event) => {
                login(event).catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                });
              }}
            >
              <Field label="Username">
                <input
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  maxLength={100}
                  disabled={pending}
                />
              </Field>
              <PasswordField
                label="Password"
                name="password"
                autoComplete="current-password"
                required
                maxLength={128}
                disabled={pending}
              />
              {error ? <Alert>{error}</Alert> : null}
              <button className="primary full" disabled={pending}>
                {pending ? (
                  <>
                    <Spinner size={12} />
                    Signing in…
                  </>
                ) : (
                  'Sign in to brand portal'
                )}
              </button>
            </form>
            <p className="caption">
              Need access or a password reset? Contact your agency
              administrator.
            </p>
          </section>
        </main>
      )}
    </div>
  );
}
