import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

export function CatalogDialog({
  title,
  pending,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  pending: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`business-dialog ${wide ? 'portal-document-dialog' : 'catalog-dialog'}`}
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <div className="business-dialog-heading">
        <h2 id={heading}>{title}</h2>
        <button
          type="button"
          className="secondary compact"
          disabled={pending}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}
