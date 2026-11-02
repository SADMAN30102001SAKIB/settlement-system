import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import { ConfirmationProvider } from './components/confirmation-provider';
import { applyTheme, readTheme } from './lib/theme';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './styles.css';

const root = document.getElementById('root');
applyTheme(readTheme());
if (!root) throw new Error('Missing application root');

document.addEventListener(
  'wheel',
  (event) => {
    const focused = document.activeElement;
    if (
      focused instanceof HTMLInputElement &&
      focused.type === 'number' &&
      event.target === focused
    )
      focused.blur();
  },
  { capture: true, passive: true },
);

createRoot(root).render(
  <StrictMode>
    <ConfirmationProvider>
      <App />
    </ConfirmationProvider>
  </StrictMode>,
);
