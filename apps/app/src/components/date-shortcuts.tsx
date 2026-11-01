import { today } from '../lib/format';

export function DateShortcuts({
  onSelect,
}: {
  onSelect: (from: string, to: string) => void;
}) {
  return (
    <label className="date-shortcuts">
      Quick dates
      <select
        aria-label="Quick dates"
        value=""
        onChange={(event) => {
          const end = today();
          const date = new Date(`${end}T12:00:00Z`);
          let from = end,
            to = end;
          if (event.target.value === 'week') {
            date.setUTCDate(date.getUTCDate() - 6);
            from = date.toISOString().slice(0, 10);
          }
          if (event.target.value === 'month') from = `${end.slice(0, 7)}-01`;
          if (event.target.value === 'previous') {
            date.setUTCDate(0);
            to = date.toISOString().slice(0, 10);
            from = `${to.slice(0, 7)}-01`;
          }
          onSelect(from, to);
        }}
      >
        <option value="" disabled>
          Choose a range
        </option>
        <option value="today">Today</option>
        <option value="week">Last 7 days</option>
        <option value="month">This month</option>
        <option value="previous">Last month</option>
      </select>
    </label>
  );
}
