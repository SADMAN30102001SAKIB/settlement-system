export function Pagination({
  page,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  pending = false,
  label = 'entries',
}: {
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  pending?: boolean;
  label?: string;
}) {
  return (
    <nav className="pagination-actions" aria-label={`${label} pagination`}>
      <button
        type="button"
        className="secondary compact"
        disabled={pending || !hasPrevious}
        onClick={onPrevious}
      >
        Previous {label}
      </button>
      <span>
        Page {page} · 20 {label} per page
      </span>
      <button
        type="button"
        className="secondary compact"
        disabled={pending || !hasNext}
        onClick={onNext}
      >
        Next {label}
      </button>
    </nav>
  );
}
