import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import { z } from 'zod';
import { adminAccountSchema } from '../../../shared/access';
import { api } from '../../lib/api';
import { formText } from '../../lib/format';
import {
  Alert,
  ErrorMessage,
  Field,
  PageHeading,
  Spinner,
} from '../../components/ui';
import { PasswordField } from '../../components/password-field';

export function AccountSettings({
  onSaved,
}: {
  onSaved: (username: string) => void;
}) {
  const [item, setItem] = useState<z.infer<typeof adminAccountSchema> | null>(
      null,
    ),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [pending, setPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api('/auth/account', z.object({ item: adminAccountSchema }), {
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
  }, []);
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;
    setPending(true);
    setError('');
    setSaved(false);
    const form = new FormData(event.currentTarget),
      password = formText(form, 'password');
    try {
      if (password !== formText(form, 'confirmPassword'))
        throw new Error('New passwords do not match.');
      const result = await api(
        '/auth/account',
        z.object({ item: adminAccountSchema }),
        {
          method: 'PUT',
          body: {
            username: formText(form, 'username'),
            currentPassword: formText(form, 'currentPassword'),
            ...(password ? { password } : {}),
            version: item.version,
          },
        },
      );
      setItem(result.item);
      onSaved(result.item.username);
      setSaved(true);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE / ACCOUNT"
        title="Your sign-in, under your control"
        description="Update your administrator login username and password. Brand logins are managed separately from Brands & costs."
      />
      <section className="panel account-settings">
        <h2>Administrator account</h2>
        <p className="muted">Use this username when signing in.</p>
        {item ? (
          <form
            key={item.version}
            onSubmit={(event) => {
              save(event).catch((reason: unknown) => {
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
                defaultValue={item.username}
                disabled={pending}
              />
            </Field>
            <PasswordField
              label="Current password"
              name="currentPassword"
              autoComplete="current-password"
              required
              maxLength={128}
              disabled={pending}
            />
            <PasswordField
              label="New password"
              name="password"
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              disabled={pending}
              hint="Optional when changing only your username. Use at least 15 characters."
            />
            <PasswordField
              label="Confirm new password"
              name="confirmPassword"
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              disabled={pending}
            />
            <p className="caption">
              Other administrator sessions will be signed out. Brand sessions
              and business records are not changed.
            </p>
            {error ? <Alert>{error}</Alert> : null}
            {saved ? (
              <p className="success" role="status">
                Sign-in details updated. Other administrator sessions have been
                signed out.
              </p>
            ) : null}
            <button className="primary" disabled={pending}>
              {pending ? (
                <>
                  <Spinner size={12} />
                  Saving…
                </>
              ) : (
                'Update sign-in details'
              )}
            </button>
          </form>
        ) : error ? (
          <Alert>
            {error}
            <button
              className="secondary compact"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload account
            </button>
          </Alert>
        ) : (
          <p role="status">
            <Spinner size={12} />
            Loading account…
          </p>
        )}
      </section>
    </>
  );
}
