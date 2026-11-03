import { useEffect } from 'react';
import { useConfirmation } from './confirmation-context';

export function AssetLoadRecovery() {
  const confirm = useConfirmation();
  useEffect(() => {
    let handling = false;
    function recover() {
      if (handling) return;
      handling = true;
      confirm({
        title: 'Reload required',
        message:
          'A required app file could not load, possibly after an update or connection issue. Reload the app, then try downloading again. Saved invoices will not change. Save any unsaved entries before reloading, or cancel and use Print.',
        action: 'Reload app',
      })
        .then((accepted) => {
          handling = false;
          if (accepted) window.location.reload();
        })
        .catch(() => {
          handling = false;
        });
    }
    window.addEventListener('pdf:loadError', recover);
    return () => {
      window.removeEventListener('pdf:loadError', recover);
    };
  }, [confirm]);
  return null;
}
