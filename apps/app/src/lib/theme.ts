export type Theme = 'light' | 'dark' | 'system';

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem('hexa-theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset['theme'] =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
}
