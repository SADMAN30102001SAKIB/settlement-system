import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { z } from 'zod';

import { Alert, ErrorMessage, Field, Spinner } from '../../components/ui';
import { api, okSchema } from '../../lib/api';
import { formText } from '../../lib/format';
import { ThemePicker } from '../../components/theme-picker';

export function Login({
  initialized,
  onLogin,
}: {
  initialized: boolean;
  onLogin: (username: string) => void;
}) {
  const [setup, setSetup] = useState(!initialized);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    const form = new FormData(event.currentTarget);
    const username = formText(form, 'username');
    const password = formText(form, 'password');
    try {
      if (setup) {
        await api('/auth/setup', okSchema, {
          method: 'POST',
          body: {
            username,
            password,
            setupToken: formText(form, 'setupToken'),
          },
        });
        setSetup(false);
      }
      const session = await api(
        '/auth/login',
        z.object({ username: z.string() }),
        { method: 'POST', body: { username, password } },
      );
      onLogin(session.username);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="auth-layout">
      <div className="auth-theme">
        <ThemePicker />
      </div>
      <section className="auth-story">
        <div className="wordmark">
          <span className="brand-mark">H</span> HEXA
          <span className="wordmark-sub">/ WORKSPACE</span>
        </div>
        <div>
          <p className="eyebrow">Clarity in every number</p>
          <h1>
            More clarity.
            <br />
            Less admin.
          </h1>
          <p>
            Orders, advertising, settlements.
            <br />
            One connected workspace for your agency.
          </p>
        </div>
        <small>Hexa Agency Ltd. · Settlement management</small>
      </section>
      <main className="auth-form">
        <div className="auth-inner">
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h2>{setup ? 'Set up your workspace' : 'Welcome back'}</h2>
          <p className="muted">
            {setup
              ? 'Create the single administrator account using your private installation token.'
              : 'Sign in to manage your agency’s operations.'}
          </p>
          <form
            onSubmit={(event) => {
              submit(event).catch((reason: unknown) => {
                setError(ErrorMessage(reason));
              });
            }}
            onChange={() => {
              setError('');
            }}
          >
            <Field label="Username">
              <input
                name="username"
                autoComplete="username"
                required
                maxLength={80}
              />
            </Field>
            <Field
              label="Password"
              hint={
                setup
                  ? 'Use at least 15 characters. A passphrase works well.'
                  : undefined
              }
            >
              <input
                name="password"
                type="password"
                autoComplete={setup ? 'new-password' : 'current-password'}
                required
                minLength={setup ? 15 : 1}
                maxLength={128}
              />
            </Field>
            {setup ? (
              <Field
                label="Installation token"
                hint="Configured privately as ADMIN_SETUP_TOKEN. Never share it publicly."
              >
                <input
                  name="setupToken"
                  type="password"
                  autoComplete="off"
                  required
                  minLength={32}
                  maxLength={256}
                />
              </Field>
            ) : null}
            {error ? <Alert>{error}</Alert> : null}
            <button className="primary full" type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Spinner size={12} /> Please wait…
                </>
              ) : setup ? (
                'Create admin & sign in'
              ) : (
                'Sign in to workspace'
              )}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="auth-footnote">
            Your session is private. Business data is never stored in this
            browser’s local storage.
          </p>
        </div>
      </main>
    </div>
  );
}
