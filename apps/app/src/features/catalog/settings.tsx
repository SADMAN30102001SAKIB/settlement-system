import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { z } from 'zod';
import { parsePercentage } from '@settlement/domain/money';

import {
  Alert,
  ErrorMessage,
  Field,
  PageHeading,
  Spinner,
} from '../../components/ui';
import { api, settingsSchema } from '../../lib/api';
import type { Settings as SettingsData } from '../../lib/api';
import { formText } from '../../lib/format';
import { ImageUpload } from '../../components/image-upload';
import { useConfirmation } from '../../components/confirmation-context';

export function Settings({
  settings,
  refresh,
}: {
  settings: SettingsData;
  refresh: () => Promise<void>;
}) {
  const confirm = useConfirmation();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  async function reset() {
    if (
      !(await confirm({
        title: 'Restore company details?',
        message:
          'Your company name, contact details and signature label will return to the original Hexa defaults. Your agency percentage and invoice images will not change.',
        action: 'Restore details',
      }))
    )
      return;
    setPending(true);
    setError('');
    try {
      await api('/manage/settings/reset', z.object({ item: settingsSchema }), {
        method: 'POST',
        body: {},
      });
      await refresh();
      setFormVersion((version) => version + 1);
      setSaved(true);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaved(false);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const value = (key: string) => formText(form, key).trim();
      const agencyBasisPoints = parsePercentage(value('percentage'));
      await api('/manage/settings', z.object({ item: settingsSchema }), {
        method: 'PUT',
        body: {
          companyName: value('companyName'),
          address: value('address'),
          phone: value('phone'),
          email: value('email'),
          signatureLabel: value('signatureLabel'),
          agencyBasisPoints,
        },
      });
      await refresh();
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
        eyebrow="WORKSPACE / SETTINGS"
        title="Make it yours"
        description="Company details appear on your settlement and advertising invoices."
      />
      <div className="settings-layout">
        <section className="panel">
          <form
            key={formVersion}
            onSubmit={(event) => {
              save(event).catch((reason: unknown) => {
                setError(ErrorMessage(reason));
              });
            }}
            onChange={() => {
              setError('');
              setSaved(false);
            }}
          >
            <h2>Invoice identity</h2>
            <div className="form-grid">
              <Field label="Company name">
                <input
                  name="companyName"
                  defaultValue={settings.companyName}
                  required
                  maxLength={80}
                />
              </Field>
              <Field label="Address">
                <input
                  name="address"
                  defaultValue={settings.address}
                  maxLength={200}
                />
              </Field>
              <Field label="Contact number">
                <input
                  name="phone"
                  type="tel"
                  defaultValue={settings.phone}
                  maxLength={40}
                />
              </Field>
              <Field label="Email">
                <input
                  name="email"
                  type="email"
                  defaultValue={settings.email}
                />
              </Field>
              <Field label="Signature label">
                <input
                  name="signatureLabel"
                  defaultValue={settings.signatureLabel}
                  required
                  maxLength={80}
                />
              </Field>
              <Field
                label="Default agency percentage (%)"
                hint="Applies to new reports. Existing reports keep their saved rate."
              >
                <input
                  name="percentage"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={settings.agencyBasisPoints / 100}
                  required
                />
              </Field>
            </div>
            {error ? <Alert>{error}</Alert> : null}
            {saved ? (
              <p role="status" className="success">
                Settings saved.
              </p>
            ) : null}
            <div className="form-footer">
              <p className="muted">
                Saved reports retain their calculation inputs.
              </p>
              <button className="primary" disabled={pending}>
                {pending ? (
                  <>
                    <Spinner size={12} /> Saving…
                  </>
                ) : (
                  'Save changes'
                )}
              </button>
            </div>
          </form>
          <div className="settings-reset-row">
            <div>
              <h3>Company defaults</h3>
              <p className="caption">
                Start again with the original company details. Saved invoices
                stay unchanged.
              </p>
            </div>
            <button
              type="button"
              className="secondary"
              disabled={pending}
              onClick={() => {
                reset().catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                });
              }}
            >
              Restore company defaults
            </button>
          </div>
        </section>
        <section className="panel">
          <h2>Invoice images</h2>
          <p className="muted">
            Replace or restore your invoice artwork here. Manage and delete
            uploaded files in <a href="/files">Private files</a>.
          </p>
          <div className="invoice-images-grid">
            <article className="invoice-image-card">
              <h3>Watermark</h3>
              <ImageUpload
                kind="watermark"
                currentId={settings.watermarkFileId}
                onChange={async () => {
                  await refresh();
                }}
              />
            </article>
            <article className="invoice-image-card">
              <h3>Signature</h3>
              <ImageUpload
                kind="signature"
                currentId={settings.signatureFileId}
                onChange={async () => {
                  await refresh();
                }}
              />
            </article>
          </div>
        </section>
        <section className="panel invoice-stamp-settings">
          <h2>Payment status stamps</h2>
          <p className="muted">
            Upload transparent artwork for Paid, Unpaid and Due. These stamps
            are used on invoices and payment receipts. Advance and N/A have no
            stamp. Replacing artwork updates PDFs using that status; previous
            files remain in Private files.
          </p>
          <div className="invoice-images-grid">
            {(
              [
                ['stamp-paid', 'Paid', settings.paidStampFileId],
                ['stamp-unpaid', 'Unpaid', settings.unpaidStampFileId],
                ['stamp-due', 'Due', settings.dueStampFileId],
              ] as const
            ).map(([kind, label, currentId]) => (
              <article className="invoice-image-card" key={kind}>
                <h3>{label} stamp</h3>
                <ImageUpload
                  kind={kind}
                  currentId={currentId}
                  onChange={async () => {
                    await refresh();
                  }}
                />
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
