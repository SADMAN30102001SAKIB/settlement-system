const paths: Readonly<Record<string, string>> = {
  Undo: 'M9 14 4 9l5-5M4 9h10a5 5 0 0 1 0 10h-2',
  Redo: 'm15 14 5-5-5-5m5 5H10a5 5 0 0 0 0 10h2',
  Bold: 'M7 4h6a4 4 0 0 1 0 8H7zm0 8h7a4 4 0 0 1 0 8H7z',
  Italic: 'M12 4h8M4 20h8M15 4 9 20',
  Underline: 'M6 4v7a6 6 0 0 0 12 0V4M4 21h16',
  Strikethrough:
    'M18 7c-1-2-3-3-6-3-5 0-7 5-3 7M3 12h18m-4 3c2 3-1 5-5 5-3 0-5-1-6-3',
  'Letter text color': 'm5 16 6-12 6 12M7 12h8M4 21h16',
  'Letter highlight': 'm7 14 8-10 5 4-8 10H7zM5 16l2-2m-3 7h16',
  'Text alignment': 'M4 5h16M4 10h10M4 15h16M4 20h10',
  'Line spacing': 'M7 4v16m-3-3 3 3 3-3M4 7l3-3 3 3m4-2h6m-6 7h6m-6 7h6',
  'Insert link':
    'M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2m2 6a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2',
  'Insert image': 'M4 4h16v16H4zM5 16l4-4 4 4 2-2 4 3M15 8h.01',
  Checklist: 'm3 6 2 2 4-4m3 3h9M3 16l2 2 4-4m3 3h9',
  'Bulleted list': 'M4 6h.01M4 12h.01M4 18h.01M9 6h12M9 12h12M9 18h12',
  'Numbered list':
    'M3 7h3m-1 0V3L3 4m6 2h12M3 13c0-2 4-2 4 0 0 1-4 2-4 4h4m2-2h12',
  'Insert table': 'M4 4h16v16H4zm0 5h16M4 14h16M10 4v16M15 4v16',
  'More formatting': 'M5 12h.01M12 12h.01M19 12h.01',
};

export function LetterToolbarIcon({ name }: { name: string }) {
  const path = paths[name];
  if (!path) return null;
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
