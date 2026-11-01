import { useRef, useState } from 'react';
import { z } from 'zod';
import {
  checklistPage,
  checklistState,
  checklistTask,
} from '../../../shared/checklist';
import type { checklistRow } from '../../../shared/checklist';
import { api } from '../../lib/api';
import type { Brand } from '../../lib/api';
import { today, dateLabel } from '../../lib/format';
import { useInfiniteQuery } from '../../lib/infinite-query';
import { ScrollList, VirtualBody } from '../../components/scroll-list';
import { ErrorMessage, Field, Spinner } from '../../components/ui';

type Row = z.infer<typeof checklistRow>;
type Task = z.infer<typeof checklistTask>;
interface Feedback {
  pending: boolean;
  error: string;
  task: Task;
  done: boolean;
}
const stateResponse = z.object({ item: checklistState });

function ChecklistDay({
  date,
  revision,
  onBusy,
}: {
  date: string;
  revision: string;
  onBusy: (count: number) => void;
}) {
  const list = useInfiniteQuery(
    `/manage/daily-checklist?date=${date}`,
    checklistPage,
    revision,
  );
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const pending = useRef(new Set<string>());
  async function save(row: Row, task: Task, done: boolean) {
    if (pending.current.has(row.id)) return;
    pending.current.add(row.id);
    onBusy(pending.current.size);
    setFeedback((current) => ({
      ...current,
      [row.id]: { pending: true, error: '', task, done },
    }));
    list.setItems((items) =>
      items.map((item) =>
        item.id === row.id ? { ...item, [task]: done } : item,
      ),
    );
    let latest: z.infer<typeof checklistState> = row;
    let error = '';
    try {
      latest = (
        await api(`/manage/daily-checklist/${row.id}`, stateResponse, {
          method: 'PATCH',
          body: { date, task, done, revision: row.revision },
        })
      ).item;
    } catch (reason) {
      error = ErrorMessage(reason);
      try {
        latest = (
          await api(
            `/manage/daily-checklist/${row.id}?date=${date}`,
            stateResponse,
          )
        ).item;
        if (latest[task] === done) error = '';
      } catch {
        // The previous state stays visible until connectivity returns.
      }
    } finally {
      list.setItems((items) =>
        items.map((item) =>
          item.id === row.id ? { ...item, ...latest } : item,
        ),
      );
      pending.current.delete(row.id);
      onBusy(pending.current.size);
      setFeedback((current) => ({
        ...current,
        [row.id]: { pending: false, error, task, done },
      }));
    }
  }
  return (
    <ScrollList
      {...list.scrollProps}
      count={list.items.length}
      label="Daily checklist brands"
      className="table-scroll checklist-scroll"
    >
      <table className="checklist-table">
        <thead>
          <tr>
            <th>Brand</th>
            <th>Orders entered</th>
            <th>Ad cost entered</th>
          </tr>
        </thead>
        <VirtualBody columns={3}>
          {list.items.map((row) => {
            const status = feedback[row.id];
            return (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                  {status ? (
                    <div className="checklist-feedback" aria-live="polite">
                      {status.pending ? (
                        <span>
                          <Spinner size={12} />
                          Saving…
                        </span>
                      ) : status.error ? (
                        <div role="alert">
                          <span>{status.error}</span>{' '}
                          <button
                            type="button"
                            className="secondary compact"
                            onClick={() => {
                              save(row, status.task, status.done).catch(
                                () => undefined,
                              );
                            }}
                          >
                            Retry save
                          </button>
                        </div>
                      ) : (
                        <span className="success">Saved</span>
                      )}
                    </div>
                  ) : null}
                </td>
                {checklistTask.options.map((task) => (
                  <td key={task}>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={row[task]}
                        disabled={status?.pending ?? false}
                        aria-label={`${task === 'ordersDone' ? 'Orders entered' : 'Ad cost entered'} for ${row.name}`}
                        onChange={(event) => {
                          save(row, task, event.target.checked).catch(
                            () => undefined,
                          );
                        }}
                      />
                      <span className="checklist-task-label">
                        {task === 'ordersDone'
                          ? 'Orders entered'
                          : 'Ad cost entered'}
                      </span>
                    </label>
                  </td>
                ))}
              </tr>
            );
          })}
        </VirtualBody>
      </table>
      {!list.loading && !list.error && !list.items.length ? (
        <p className="muted checklist-empty">
          No brands yet. Add a brand to start your daily checklist.
        </p>
      ) : null}
    </ScrollList>
  );
}

function adjacentDate(value: string, step: number) {
  const result = new Date(`${value}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + step);
  return result.toISOString().slice(0, 10);
}

export function DailyChecklist({ brands }: { brands: readonly Brand[] }) {
  const [date, setDate] = useState(today),
    [draft, setDraft] = useState(today);
  const [busy, setBusy] = useState(0),
    [reload, setReload] = useState(0);
  function choose(value: string) {
    setDate(value);
    setDraft(value);
  }
  return (
    <section
      className="panel daily-checklist"
      aria-label="Daily checklist"
      aria-busy={busy > 0}
    >
      <div className="section-heading">
        <div>
          <h2>Daily checklist</h2>
          <p>
            Confirm each brand’s work for {dateLabel(date)}. Checkmarks save
            automatically.
          </p>
        </div>
        <div className="actions checklist-header-actions">
          <button
            type="button"
            className="secondary compact"
            disabled={busy > 0}
            onClick={() => {
              choose(today());
            }}
          >
            Today
          </button>
          <button
            type="button"
            className="secondary compact"
            aria-label="Refresh checklist"
            disabled={busy > 0}
            onClick={() => {
              setReload((value) => value + 1);
            }}
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="checklist-toolbar">
        <button
          type="button"
          className="secondary checklist-date-arrow"
          aria-label="Previous day"
          title="Previous day"
          disabled={busy > 0 || date === '0001-01-01'}
          onClick={() => {
            choose(adjacentDate(date, -1));
          }}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <Field label="Checklist date">
          <input
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            value={draft}
            disabled={busy > 0}
            onChange={(event) => {
              const value = event.target.value;
              setDraft(value);
              if (
                z.iso.date().safeParse(value).success &&
                value >= '0001-01-01' &&
                value <= '9999-12-31'
              )
                setDate(value);
            }}
            onBlur={() => {
              setDraft(date);
            }}
          />
        </Field>
        <button
          type="button"
          className="secondary checklist-date-arrow"
          aria-label="Next day"
          title="Next day"
          disabled={busy > 0 || date === '9999-12-31'}
          onClick={() => {
            choose(adjacentDate(date, 1));
          }}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <ChecklistDay
        key={`${date}:${String(reload)}`}
        date={date}
        revision={JSON.stringify(brands)}
        onBusy={setBusy}
      />
    </section>
  );
}
