import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import { z } from 'zod';
import { brandAccessSchema } from '../../../shared/access';
import { api } from '../../lib/api';
import type { Brand } from '../../lib/api';
import { formText } from '../../lib/format';
import { CatalogDialog } from '../../components/catalog-dialog';
import { PasswordField } from '../../components/password-field';
import { Alert, ErrorMessage, Field, Spinner } from '../../components/ui';

export function BrandAccess({
  brand,
  onClose,
}: {
  brand: Brand;
  onClose: () => void;
}) {
  const [item, setItem] = useState<z.infer<typeof brandAccessSchema> | null>(
      null,
    ),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [saved, setSaved] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api(
      `/manage/brand-access/${brand.id}`,
      z.object({ item: brandAccessSchema }),
      { signal: controller.signal },
    )
      .then((data) => {
        setItem(data.item);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      });
    return () => {
      controller.abort();
    };
  }, [brand.id, revision]);
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;
    const form = new FormData(event.currentTarget),
      password = formText(form, 'password');
    setPending(true);
    setError('');
    setSaved(false);
    try {
      if (password !== formText(form, 'confirmPassword'))
        throw new Error('Brand passwords do not match.');
      const result = await api(
        `/manage/brand-access/${brand.id}`,
        z.object({ item: brandAccessSchema }),
        {
          method: 'PUT',
          body: {
            username: formText(form, 'username'),
            enabled: form.get('enabled') === 'on',
            currentPassword: formText(form, 'currentPassword'),
            version: item.version,
            ...(password ? { password } : {}),
          },
        },
      );
      setItem(result.item);
      setSaved(true);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <CatalogDialog
      title={`${brand.name} · Login access`}
      pending={pending}
      onClose={onClose}
    >
      <div className="panel">
        <p className="muted">
          The owner can view and download only this brand’s settlement invoices,
          advertising invoices and payment receipts.
        </p>
        <p className="portal-login-address">
          Brand sign-in:{' '}
          <a href="/brand/login" target="_blank" rel="noreferrer">
            {window.location.origin}/brand/login
          </a>
        </p>
        {item ? (
          <form
            key={item.version}
            onSubmit={(event) => {
              save(event).catch((reason: unknown) => {
                setError(ErrorMessage(reason));
              });
            }}
          >
            <Field
              label="Brand username"
              hint="Use a unique username for this brand."
            >
              <input
                type="text"
                name="username"
                autoComplete="off"
                required
                maxLength={100}
                defaultValue={item.username}
                disabled={pending}
              />
            </Field>
            <PasswordField
              label="New brand password"
              name="password"
              required={item.version === 0}
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              disabled={pending}
              hint={
                item.version
                  ? 'Leave blank to keep the current password. Existing passwords are never displayed.'
                  : 'Use at least 15 characters. Share these credentials privately with the owner.'
              }
            />
            <PasswordField
              label="Confirm brand password"
              name="confirmPassword"
              required={item.version === 0}
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              disabled={pending}
            />
            <label className="check-field">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={item.enabled}
                disabled={pending}
              />{' '}
              Allow brand sign-in
            </label>
            <PasswordField
              label="Your administrator password"
              name="currentPassword"
              autoComplete="current-password"
              required
              maxLength={128}
              disabled={pending}
            />
            <p className="caption">
              Saving changes signs this brand’s existing sessions out. No
              invoices or payments are changed.
            </p>
            {saved ? (
              <p className="success" role="status">
                {item.enabled
                  ? 'Brand access saved. The owner can use the sign-in page above.'
                  : 'Brand access disabled. Existing sessions have been signed out.'}
              </p>
            ) : null}
            {error ? (
              <Alert>
                {error}
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => {
                    setItem(null);
                    setError('');
                    setSaved(false);
                    setRevision((value) => value + 1);
                  }}
                >
                  Reload access
                </button>
              </Alert>
            ) : null}
            <div className="actions">
              <button className="primary" disabled={pending}>
                {pending ? (
                  <>
                    <Spinner size={12} />
                    Saving…
                  </>
                ) : (
                  'Save brand access'
                )}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={pending}
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </form>
        ) : error ? (
          <Alert>{error}</Alert>
        ) : (
          <p role="status">
            <Spinner size={12} />
            Loading access…
          </p>
        )}
      </div>
    </CatalogDialog>
  );
}
