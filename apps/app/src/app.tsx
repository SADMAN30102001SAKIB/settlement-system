import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

import {
  Alert,
  ErrorMessage,
  Skeleton,
  SkeletonInvoice,
} from './components/ui';
import { Login } from './features/auth/login';
import { Brands } from './features/catalog/brands';
import { Settings } from './features/catalog/settings';
import { Notes } from './features/catalog/notes';
import { ReportEditor } from './features/settlements/editor';
import { History } from './features/settlements/history';
import { Invoice } from './features/settlements/invoice';
import { PaymentsPanel } from './features/payments/panel';
import { Advertising } from './features/advertising/page';
import { Business } from './features/business/page';
import { Files } from './features/catalog/files';
import {
  api,
  brandSchema,
  okSchema,
  reportDetailSchema,
  settingsSchema,
  SESSION_EXPIRED_EVENT,
} from './lib/api';
import type { Brand, Report, Settings as SettingsData } from './lib/api';
import { today } from './lib/format';
import { ThemePicker } from './components/theme-picker';
import { useConfirmation } from './components/confirmation-context';

function ReportView({
  id,
  brands,
  settings,
  edit,
  navigate,
}: {
  id: string;
  brands: Brand[];
  settings: SettingsData;
  edit: boolean;
  navigate: (path: string) => void;
}) {
  const confirm = useConfirmation();
  const [report, setReport] = useState<Report | null>(null);
  const [payments, setPayments] = useState<
    z.infer<typeof reportDetailSchema>['payments']
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api(`/manage/settlements/${id}`, reportDetailSchema, {
      signal: controller.signal,
    })
      .then((result) => {
        setReport(result.item);
        setPayments(result.payments);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      });
    return () => {
      controller.abort();
    };
  }, [id]);
  async function remove() {
    if (
      report === null ||
      !(await confirm({
        title: 'Delete settlement?',
        message: `Permanently delete ${report.invoiceNumber} and all of its payment records? This cannot be undone.`,
        action: 'Delete settlement',
        destructive: true,
      }))
    )
      return;
    await api(`/manage/settlements/${id}`, okSchema, {
      method: 'DELETE',
      body: { revision: report.revision },
    });
    navigate('/settlements');
  }
  if (error) return <Alert>{error}</Alert>;
  if (report === null) return <SkeletonInvoice kind="settlement" />;
  return edit ? (
    <ReportEditor
      key={report.id}
      report={report}
      brands={brands}
      settings={settings}
      onSaved={(saved) => {
        setReport(saved);
        navigate(`/settlements/${saved.id}`);
      }}
      onCancel={() => {
        navigate(`/settlements/${id}`);
      }}
    />
  ) : (
    <>
      <Invoice
        report={report}
        settings={settings}
        onEdit={() => {
          navigate(`/settlements/${id}/edit`);
        }}
        onBack={() => {
          navigate('/settlements');
        }}
        onDelete={() => {
          remove().catch((reason: unknown) => {
            setError(ErrorMessage(reason));
          });
        }}
      />
      <PaymentsPanel
        target={{ kind: 'settlement', targetId: report.id }}
        total={report.commission}
        paid={report.paid}
        payments={payments}
        refresh={async () => {
          const result = await api(
            `/manage/settlements/${id}`,
            reportDetailSchema,
          );
          setReport(result.item);
          setPayments(result.payments);
        }}
      />
    </>
  );
}

export function App() {
  const [path, setPath] = useState(() =>
    window.location.hash.startsWith('#/')
      ? window.location.hash.slice(1)
      : window.location.pathname === '/'
        ? '/settlements'
        : window.location.pathname,
  );
  const [session, setSession] = useState<{
    initialized: boolean;
    username: string | null;
  } | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('hexa-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [isNarrow, setIsNarrow] = useState(
    () => window.matchMedia('(max-width: 1024px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1024px)');
    const change = () => {
      setIsNarrow(media.matches);
    };
    media.addEventListener('change', change);
    return () => {
      media.removeEventListener('change', change);
    };
  }, []);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const expireSession = () => {
      setSession({ initialized: true, username: null });
      setSettings(null);
      setBrands([]);
      setError('');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expireSession);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession);
    };
  }, []);
  const refresh = useCallback(async () => {
    const data = await api(
      '/manage/bootstrap',
      z.object({ brands: z.array(brandSchema), settings: settingsSchema }),
    );
    setBrands(data.brands);
    setSettings(data.settings);
  }, []);
  const navigate = useCallback((next: string) => {
    if (window.location.pathname !== next)
      window.history.pushState(null, '', next);
    setPath(next);
    setNavOpen(false);
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    if (window.location.hash.startsWith('#/'))
      window.history.replaceState(null, '', window.location.hash.slice(1));
    const onPop = () => {
      setPath(
        window.location.pathname === '/'
          ? '/settlements'
          : window.location.pathname,
      );
      setNavOpen(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPop);
    const onLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (
        link === null ||
        link.hasAttribute('download') ||
        (link.target && link.target !== '_self')
      )
        return;
      const url = new URL(link.href);
      if (
        url.origin !== window.location.origin ||
        url.hash ||
        url.search ||
        !/^\/(settlements|brands|settings|notes|advertising|business|files)(\/|$)/.test(
          url.pathname,
        )
      )
        return;
      event.preventDefault();
      navigate(url.pathname);
    };
    document.addEventListener('click', onLink);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onLink);
    };
  }, [navigate]);
  useEffect(() => {
    const controller = new AbortController();
    api(
      '/auth/status',
      z.object({ initialized: z.boolean(), username: z.string().nullable() }),
      { signal: controller.signal },
    )
      .then(async (data) => {
        if (controller.signal.aborted) return;
        setSession(data);
        if (data.username !== null) await refresh();
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      });
    return () => {
      controller.abort();
    };
  }, [refresh]);
  async function logout() {
    setWorking(true);
    setError('');
    try {
      await api('/auth/logout', okSchema, { method: 'POST', body: {} });
      setSession({ initialized: true, username: null });
      setSettings(null);
      setBrands([]);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setWorking(false);
    }
  }
  if (session?.username === null)
    return (
      <Login
        initialized={session.initialized}
        onLogin={(username) => {
          setSession({ initialized: true, username });
          refresh().catch((reason: unknown) => {
            setError(ErrorMessage(reason));
          });
        }}
      />
    );
  if (session === null || settings === null)
    return (
      <main className="boot-screen">
        <div className="brand-mark">H</div>
        <h1>
          {error ? 'Unable to open workspace' : 'Opening your workspace…'}
        </h1>
        {error ? (
          <>
            <Alert>{error}</Alert>
            <button
              className="secondary"
              onClick={() => {
                window.location.reload();
              }}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <p>Connecting securely to your data.</p>
            <Skeleton
              className="boot-loader"
              height={4}
              radius={2}
              aria-label="Connecting securely…"
            />
          </>
        )}
      </main>
    );
  const parts = path.split('/').filter(Boolean);
  const reportId =
    parts[0] === 'settlements' && parts[1] !== 'new' ? parts[1] : undefined;
  return (
    <div className={`workspace ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <aside
        id="workspace-sidebar"
        className={`sidebar ${navOpen ? 'is-open' : ''}`}
        inert={isNarrow ? !navOpen : sidebarCollapsed}
        aria-hidden={isNarrow ? !navOpen : sidebarCollapsed}
      >
        <a
          href="/settlements"
          className="wordmark"
          onClick={() => {
            setNavOpen(false);
          }}
        >
          <span className="brand-mark">H</span>
          <span>
            HEXA<small>AGENCY WORKSPACE</small>
          </span>
        </a>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {[
            ['/settlements', 'Settlement ledger', '01'],
            ['/brands', 'Brands & costs', '02'],
            ['/settings', 'Invoice settings', '03'],
            ['/notes', 'Notes & progress', '04'],
            ['/advertising', 'Advertising', '05'],
            ['/business', 'Business tracking', '06'],
            ['/files', 'Private files', '07'],
          ].map(([href, label, marker]) => (
            <a
              key={href}
              href={href ?? '/settlements'}
              className={path.startsWith(href ?? '/') ? 'active' : ''}
              aria-current={path.startsWith(href ?? '/') ? 'page' : undefined}
              onClick={() => {
                setNavOpen(false);
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                {marker}
              </span>
              {label}
              <span className="nav-arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-label">
            <span className="online-dot" /> Private admin workspace
          </div>
          <div className="user-row">
            <span className="avatar">
              {session.username.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{session.username}</strong>
              <small>Administrator</small>
            </div>
            <button
              className="text-button"
              disabled={working}
              onClick={() => {
                logout().catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                });
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar no-print">
          <button
            className="sidebar-toggle secondary compact"
            aria-controls="workspace-sidebar"
            aria-expanded={!sidebarCollapsed}
            onClick={() => {
              const next = !sidebarCollapsed;
              setSidebarCollapsed(next);
              try {
                localStorage.setItem('hexa-sidebar-collapsed', String(next));
              } catch {
                /* Collapsing still works without storage. */
              }
            }}
          >
            {sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          </button>
          <button
            className="menu-toggle secondary compact"
            aria-expanded={navOpen}
            aria-label="Toggle navigation"
            onClick={() => {
              setNavOpen((open) => !open);
            }}
          >
            Menu
          </button>
          <div className="topbar-meta">
            <ThemePicker />
            <span className="topbar-date">{today()}</span>
          </div>
        </header>
        <main id="main" className="page-content" tabIndex={-1}>
          {error ? <Alert>{error}</Alert> : null}
          {path === '/files' ? (
            <Files refresh={refresh} />
          ) : path === '/business' ? (
            <Business brands={brands} settings={settings} />
          ) : path.startsWith('/advertising') ? (
            <Advertising
              key={path}
              path={path}
              brands={brands}
              settings={settings}
              navigate={navigate}
            />
          ) : path === '/brands' ? (
            <Brands brands={brands} refresh={refresh} />
          ) : path === '/notes' ? (
            <Notes brands={brands} />
          ) : path === '/settings' ? (
            <Settings settings={settings} refresh={refresh} />
          ) : path === '/settlements/new' ? (
            <ReportEditor
              report={null}
              brands={brands}
              settings={settings}
              onSaved={(saved) => {
                navigate(`/settlements/${saved.id}`);
              }}
              onCancel={() => {
                navigate('/settlements');
              }}
            />
          ) : reportId ? (
            <ReportView
              key={reportId}
              id={reportId}
              brands={brands}
              settings={settings}
              edit={parts[2] === 'edit'}
              navigate={navigate}
            />
          ) : (
            <History
              brands={brands}
              onNew={() => {
                navigate('/settlements/new');
              }}
              onView={(id) => {
                navigate(`/settlements/${id}`);
              }}
            />
          )}
        </main>
        <footer className="workspace-footer no-print">
          <span>Hexa Agency Ltd.</span>
          <span>Every figure. Accounted for.</span>
        </footer>
      </div>
    </div>
  );
}
