import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmationContext } from './confirmation-context';
import type { Confirmation } from './confirmation-context';

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const resolve = useRef<((confirmed: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const accept = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const confirm = useCallback((options: Confirmation) => {
    if (resolve.current !== null) return Promise.resolve(false);
    return new Promise<boolean>((done) => {
      resolve.current = done;
      setRequest(options);
    });
  }, []);
  function finish(confirmed: boolean) {
    dialog.current?.close();
    resolve.current?.(confirmed);
    resolve.current = null;
    setRequest(null);
  }
  useEffect(() => {
    if (request === null) return;
    const element = dialog.current;
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === cancel.current) {
        event.preventDefault();
        accept.current?.focus();
      } else if (!event.shiftKey && document.activeElement === accept.current) {
        event.preventDefault();
        cancel.current?.focus();
      }
    }
    element?.addEventListener('keydown', trapFocus);
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.removeEventListener('keydown', trapFocus);
    };
  }, [request]);
  return (
    <ConfirmationContext value={confirm}>
      {children}
      {request === null
        ? null
        : createPortal(
            <dialog
              ref={dialog}
              className="confirmation-dialog"
              role="alertdialog"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              onCancel={(event) => {
                event.preventDefault();
                finish(false);
              }}
            >
              <p className="eyebrow">
                {request.destructive ? 'PLEASE CONFIRM' : 'RESTORE DEFAULTS'}
              </p>
              <h2 id={titleId}>{request.title}</h2>
              <p id={descriptionId} className="muted">
                {request.message}
              </p>
              <div className="confirmation-actions">
                <button
                  ref={cancel}
                  className="secondary"
                  onClick={() => {
                    finish(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  ref={accept}
                  className={request.destructive ? 'danger-button' : 'primary'}
                  onClick={() => {
                    finish(true);
                  }}
                >
                  {request.action}
                </button>
              </div>
            </dialog>,
            document.body,
          )}
    </ConfirmationContext>
  );
}
