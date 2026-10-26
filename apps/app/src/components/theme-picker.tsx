import { useEffect, useState } from 'react';
import { applyTheme, readTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';

export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      applyTheme(theme);
    };
    apply();
    try {
      localStorage.setItem('hexa-theme', theme);
    } catch {
      /* Theme works without browser storage. */
    }
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
    };
  }, [theme]);
  return (
    <label className="theme-picker">
      <span>Theme</span>
      <select
        aria-label="Color theme"
        value={theme}
        onChange={(event) => {
          const value = event.target.value;
          if (value === 'light' || value === 'dark' || value === 'system')
            setTheme(value);
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
