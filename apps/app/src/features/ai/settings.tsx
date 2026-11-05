import { useEffect, useState } from 'react';
import { aiCredentialStatus } from '../../../shared/ai';
import { api } from '../../lib/api';
import { Alert, ErrorMessage } from '../../components/ui';
import { PasswordField } from '../../components/password-field';
import { useConfirmation } from '../../components/confirmation-context';
import { formText } from '../../lib/format';

export function AiSettings() {
  const [status, setStatus] = useState<{
    configured: boolean;
    revision: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const confirm = useConfirmation();
  useEffect(() => {
    const controller = new AbortController();
    api('/manage/ai/credentials', aiCredentialStatus, {
      signal: controller.signal,
    })
      .then(setStatus)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(e));
      });
    return () => {
      controller.abort();
    };
  }, []);
  return (
    <section className="panel ai-settings">
      <h2>AI connections</h2>
      <p className="muted">
        Use Gemini to ask questions about your Meta advertising. Read-only and
        administrator-only.{' '}
        {status?.configured
          ? 'Credentials are saved.'
          : 'Connect both providers to get started.'}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const geminiKey = formText(data, 'geminiKey').trim();
          const metaToken = formText(data, 'metaToken').trim();
          setPending(true);
          setSaved(false);
          setError('');
          api('/manage/ai/credentials', aiCredentialStatus, {
            method: 'PUT',
            body: {
              ...(geminiKey ? { geminiKey } : {}),
              ...(metaToken ? { metaToken } : {}),
              revision: status?.revision ?? 0,
            },
          })
            .then((value) => {
              setStatus(value);
              form.reset();
              setSaved(true);
            })
            .catch((e: unknown) => {
              setError(ErrorMessage(e));
            })
            .finally(() => {
              setPending(false);
            });
        }}
      >
        <div className="form-grid">
          <PasswordField
            label="Gemini API key"
            name="geminiKey"
            autoComplete="off"
            maxLength={4096}
            required={!status?.configured}
            disabled={pending}
            hint={
              status?.configured
                ? 'Leave blank to keep the saved key.'
                : 'Your Google Gemini API key.'
            }
          />
          <PasswordField
            label="Meta access token"
            name="metaToken"
            autoComplete="off"
            maxLength={4096}
            required={!status?.configured}
            disabled={pending}
            hint={
              status?.configured
                ? 'Leave blank to keep the saved token.'
                : 'A token with access to Meta Ads MCP.'
            }
          />
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {saved ? (
          <p role="status" className="success">
            AI connections saved.
          </p>
        ) : null}
        <div className="form-footer ai-settings-actions">
          {status?.configured ? (
            <button
              className="secondary"
              type="button"
              disabled={pending}
              onClick={() => {
                confirm({
                  title: 'Disconnect AI providers?',
                  message:
                    'Saved credentials will be removed. Your conversations and business data will stay unchanged.',
                  action: 'Disconnect',
                })
                  .then(async (accepted) => {
                    if (!accepted) return;
                    setPending(true);
                    setError('');
                    try {
                      setStatus(
                        await api(
                          '/manage/ai/credentials',
                          aiCredentialStatus,
                          {
                            method: 'DELETE',
                            body: { revision: status.revision },
                          },
                        ),
                      );
                      setSaved(false);
                    } catch (e) {
                      setError(ErrorMessage(e));
                    } finally {
                      setPending(false);
                    }
                  })
                  .catch((e: unknown) => {
                    setError(ErrorMessage(e));
                  });
              }}
            >
              Disconnect
            </button>
          ) : null}
          <button className="primary" disabled={pending || status === null}>
            {pending ? 'Saving…' : 'Save AI connections'}
          </button>
        </div>
      </form>
    </section>
  );
}
