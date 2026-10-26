import { cloneElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactElement<{
    id?: string;
    'aria-describedby'?: string | undefined;
  }>;
  hint?: string | undefined;
}) {
  const generatedId = useId();
  const id = children.props.id ?? generatedId;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        'aria-describedby': hint
          ? `${id}-hint`
          : children.props['aria-describedby'],
      })}
      {hint ? <small id={`${id}-hint`}>{hint}</small> : null}
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p className="muted">{children}</p>
    </div>
  );
}

export function ErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

export function Skeleton({
  className = '',
  width,
  height,
  radius,
  style,
  'aria-label': ariaLabel = 'Loading…',
}: {
  className?: string | undefined;
  width?: string | number | undefined;
  height?: string | number | undefined;
  radius?: string | number | undefined;
  style?: React.CSSProperties | undefined;
  'aria-label'?: string | undefined;
}) {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={`skeleton ${className}`.trim()}
      style={{
        width: typeof width === 'number' ? `${String(width)}px` : width,
        height: typeof height === 'number' ? `${String(height)}px` : height,
        borderRadius:
          typeof radius === 'number' ? `${String(radius)}px` : radius,
        ...style,
      }}
    >
      <span className="sr-only">{ariaLabel}</span>
    </div>
  );
}

export function SkeletonMetrics({ count = 4 }: { count?: number | undefined }) {
  return (
    <div
      className="metrics skeleton-metrics"
      role="status"
      aria-label="Loading metrics…"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="metric skeleton-metric-card">
          <Skeleton
            width="45%"
            height={12}
            radius={3}
            style={{ marginBottom: 8 }}
          />
          <Skeleton
            width="75%"
            height={26}
            radius={4}
            style={{ marginBottom: 6 }}
          />
          <Skeleton width="30%" height={10} radius={3} />
        </div>
      ))}
      <span className="sr-only">Loading metrics…</span>
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  columns = 5,
  headers,
}: {
  rows?: number | undefined;
  columns?: number | undefined;
  headers?: string[] | undefined;
}) {
  const colCount = headers ? headers.length : columns;
  return (
    <div
      className="table-scroll skeleton-table-container"
      role="status"
      aria-label="Loading table…"
    >
      <table>
        {headers && headers.length > 0 ? (
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th key={index}>{header}</th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {Array.from({ length: rows }).map((_, rIndex) => (
            <tr key={rIndex} className="skeleton-row">
              {Array.from({ length: colCount }).map((_, cIndex) => (
                <td key={cIndex}>
                  <Skeleton
                    height={16}
                    width={
                      cIndex === 0
                        ? '65%'
                        : cIndex === colCount - 1
                          ? '40%'
                          : '80%'
                    }
                    radius={4}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">Loading data…</span>
    </div>
  );
}

export function SkeletonInvoice({
  kind = 'settlement',
}: {
  kind?: 'settlement' | 'advertising' | undefined;
}) {
  return (
    <div
      className="skeleton-invoice-view"
      role="status"
      aria-label="Loading invoice…"
    >
      <div className="no-print">
        <header className="page-heading">
          <div style={{ flex: 1 }}>
            <Skeleton
              width={160}
              height={12}
              radius={3}
              style={{ marginBottom: 10 }}
            />
            <Skeleton
              width={260}
              height={28}
              radius={4}
              style={{ marginBottom: 8 }}
            />
            <Skeleton width={190} height={14} radius={3} />
          </div>
          <div className="actions">
            <Skeleton width={70} height={36} radius={6} />
            <Skeleton width={100} height={36} radius={6} />
            <Skeleton width={120} height={36} radius={6} />
          </div>
        </header>
      </div>

      <article
        className={`invoice-document ${kind === 'advertising' ? 'invoice-advertising' : 'invoice-settlement'} skeleton-invoice-document`}
      >
        <header className="invoice-header">
          <div style={{ flex: 1 }}>
            <Skeleton
              width={200}
              height={12}
              radius={3}
              style={{ marginBottom: 12 }}
            />
            <Skeleton
              width={280}
              height={24}
              radius={4}
              style={{ marginBottom: 8 }}
            />
            <Skeleton
              width={180}
              height={14}
              radius={3}
              style={{ marginBottom: 6 }}
            />
            <Skeleton width={140} height={14} radius={3} />
          </div>
          <div className="invoice-logo skeleton-logo">
            <Skeleton width={48} height={48} radius={12} />
          </div>
        </header>

        <div
          className="invoice-meta"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 16,
          }}
        >
          <div className="panel" style={{ padding: 16 }}>
            <Skeleton
              width={100}
              height={10}
              radius={2}
              style={{ marginBottom: 8 }}
            />
            <Skeleton
              width={140}
              height={20}
              radius={4}
              style={{ marginBottom: 6 }}
            />
            <Skeleton width={120} height={12} radius={3} />
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <Skeleton
              width={100}
              height={10}
              radius={2}
              style={{ marginBottom: 8 }}
            />
            <Skeleton
              width={140}
              height={20}
              radius={4}
              style={{ marginBottom: 6 }}
            />
            <Skeleton width={120} height={12} radius={3} />
          </div>
        </div>

        <section style={{ marginTop: 24 }}>
          <Skeleton
            width={220}
            height={18}
            radius={4}
            style={{ marginBottom: 16 }}
          />
          <SkeletonTable rows={4} columns={kind === 'advertising' ? 3 : 3} />
        </section>

        <div
          className="invoice-final"
          style={{
            marginTop: 24,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Skeleton width={160} height={18} radius={4} />
          <Skeleton width={140} height={26} radius={4} />
        </div>
      </article>
      <span className="sr-only">Loading invoice…</span>
    </div>
  );
}

export function Spinner({
  size = '1em',
  className = '',
  label,
}: {
  size?: string | number | undefined;
  className?: string | undefined;
  label?: string | undefined;
}) {
  const dimension = typeof size === 'number' ? `${String(size)}px` : size;
  if (!label) {
    return (
      <span
        aria-hidden="true"
        className={`spinner ${className}`.trim()}
        style={{ width: dimension, height: dimension }}
      />
    );
  }
  return (
    <span
      className={`spinner ${className}`.trim()}
      style={{ width: dimension, height: dimension }}
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}
