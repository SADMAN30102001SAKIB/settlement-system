import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { z } from 'zod';
import {
  aiConversationList,
  aiTurnList,
  aiCredentialStatus,
  aiEvent,
} from '../../../shared/ai';
import { api, okSchema, SESSION_EXPIRED_EVENT } from '../../lib/api';
import { useInfiniteQuery } from '../../lib/infinite-query';
import { ScrollList } from '../../components/scroll-list';
import { Alert, ErrorMessage } from '../../components/ui';
import { useConfirmation } from '../../components/confirmation-context';

type Turn = z.infer<typeof aiTurnList>['items'][number];

export function AiChat() {
  const list = useInfiniteQuery('/manage/ai/conversations', aiConversationList);
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [older, setOlder] = useState<number | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activity, setActivity] = useState('');
  const [copied, setCopied] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const pendingId = useRef<string | null>(null);
  const confirm = useConfirmation();
  const serverRunning =
    !busy && turns.some((turn) => turn.status === 'running');
  useEffect(() => {
    const abort = new AbortController();
    api('/manage/ai/credentials', aiCredentialStatus, { signal: abort.signal })
      .then((r) => {
        setConfigured(r.configured);
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(ErrorMessage(e));
      });
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!selected || selected === pendingId.current) return;
    const abort = new AbortController();
    api(`/manage/ai/conversations/${selected}`, aiTurnList, {
      signal: abort.signal,
    })
      .then((r) => {
        setTurns(r.items);
        setRevision(r.item.revision);
        setOlder(r.next?.before ?? null);
        setLoading(false);
        follow.current = true;
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setError(ErrorMessage(e));
          setLoading(false);
        }
      });
    return () => {
      abort.abort();
    };
  }, [selected]);
  useEffect(() => {
    if (follow.current) end.current?.scrollIntoView({ block: 'nearest' });
  }, [turns, activity]);

  async function reload(id: string) {
    const r = await api(`/manage/ai/conversations/${id}`, aiTurnList);
    setTurns(r.items);
    setRevision(r.item.revision);
    setOlder(r.next?.before ?? null);
  }
  async function stop() {
    const id = pendingId.current ?? selected;
    controller.current?.abort();
    if (id)
      await api(`/manage/ai/conversations/${id}/cancel`, okSchema, {
        method: 'POST',
        body: {},
      });
    if (id) await reload(id);
  }
  async function send() {
    if (!draft.trim() || busy || loading) return;
    const question = draft.trim();
    const id = selected ?? crypto.randomUUID();
    const turnId = crypto.randomUUID();
    setBusy(true);
    setError('');
    setDraft('');
    follow.current = true;
    const abort = new AbortController();
    controller.current = abort;
    pendingId.current = id;
    try {
      if (!selected) {
        await api('/manage/ai/conversations', okSchema, {
          method: 'POST',
          body: { id },
          signal: abort.signal,
        });
        setSelected(id);
      }
      setTurns((items) => [
        ...items,
        {
          id: turnId,
          question,
          answer: '',
          status: 'running',
          createdAt: Date.now(),
        },
      ]);
      setActivity('Connecting…');
      const response = await fetch(
        `/api/manage/ai/conversations/${id}/messages`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: turnId,
            question,
            revision: selected ? revision : 0,
          }),
          signal: abort.signal,
        },
      );
      if (response.status === 401)
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      if (!response.ok) {
        const result = z
          .object({ error: z.string() })
          .parse(await response.json());
        throw new Error(result.error);
      }
      if (!response.body)
        throw new Error(
          'Streaming is unavailable. Reload this chat to check the response.',
        );
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = '',
        done = false;
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        buffer += result.value.replaceAll('\r\n', '\n');
        let split;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const entry = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const data = entry
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          const event = aiEvent.parse(JSON.parse(data) as unknown);
          if (event.type === 'status') setActivity(event.text);
          if (event.type === 'delta')
            setTurns((items) =>
              items.map((t) =>
                t.id === turnId ? { ...t, answer: t.answer + event.text } : t,
              ),
            );
          if (event.type === 'done') done = true;
          if (event.type === 'error') throw new Error(event.text);
        }
      }
      if (!done)
        throw new Error(
          'Connection interrupted. Reload this chat before sending again.',
        );
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(ErrorMessage(e));
        setDraft(question);
      }
    } finally {
      controller.current = null;
      pendingId.current = null;
      setLoading(true);
      setBusy(false);
      setActivity('');
      setSelected(id);
      list.refresh();
      await reload(id).catch((e: unknown) => {
        setError(ErrorMessage(e));
      });
      setLoading(false);
    }
  }
  return (
    <section className="ai-chat" aria-label="AI chat">
      <aside className={`ai-history ${historyOpen ? 'is-open' : ''}`}>
        <div className="ai-history-heading">
          <h2>AI Chat</h2>
          <button
            className="secondary compact ai-history-toggle"
            aria-expanded={historyOpen}
            onClick={() => {
              setHistoryOpen(!historyOpen);
            }}
          >
            History
          </button>
          <button
            className="secondary compact"
            disabled={busy || loading}
            onClick={() => {
              setSelected(null);
              setTurns([]);
              setRevision(0);
              setOlder(null);
              setError('');
              setDraft('');
            }}
          >
            New chat
          </button>
        </div>
        <ScrollList
          label="Chat history"
          count={list.items.length}
          {...list.scrollProps}
        >
          {list.items.map((chat) => (
            <div
              className={`ai-history-row ${selected === chat.id ? 'is-selected' : ''}`}
              key={chat.id}
            >
              <button
                className="ai-chat-title"
                aria-label={`Open chat: ${chat.title}`}
                disabled={busy || loading}
                aria-current={selected === chat.id ? 'page' : undefined}
                onClick={() => {
                  if (selected !== chat.id) {
                    setLoading(true);
                    setTurns([]);
                    setError('');
                    setSelected(chat.id);
                    setHistoryOpen(false);
                  }
                }}
              >
                {chat.title}
              </button>
              <button
                className="secondary compact"
                aria-label={`Delete chat ${chat.title}`}
                disabled={busy || loading}
                onClick={() => {
                  confirm({
                    title: 'Delete this chat?',
                    message:
                      'This conversation will be permanently removed. Meta advertising and settlement records will not change.',
                    action: 'Delete chat',
                  })
                    .then(async (accepted) => {
                      if (!accepted) return;
                      await api(
                        `/manage/ai/conversations/${chat.id}`,
                        okSchema,
                        { method: 'DELETE', body: {} },
                      );
                      if (selected === chat.id) {
                        setSelected(null);
                        setTurns([]);
                        setRevision(0);
                      }
                      list.refresh();
                    })
                    .catch((e: unknown) => {
                      setError(ErrorMessage(e));
                    });
                }}
              >
                ×
              </button>
            </div>
          ))}
        </ScrollList>
      </aside>
      <div className="ai-thread">
        <header className="ai-thread-heading">
          <div>
            <h1>Ask about your advertising</h1>
            <p className="caption">Meta Ads · Read-only · Administrator only</p>
          </div>
          {serverRunning ? (
            <button
              className="secondary compact"
              onClick={() => {
                stop().catch((e: unknown) => {
                  setError(ErrorMessage(e));
                });
              }}
            >
              Stop response
            </button>
          ) : null}
        </header>
        {configured === false ? (
          <div className="ai-connection-notice">
            Connect your Gemini API key and Meta token in{' '}
            <a href="/settings">Invoice settings</a> to start chatting.
          </div>
        ) : null}
        <div
          ref={view}
          className="ai-messages"
          role="region"
          aria-label="Conversation messages"
          onScroll={() => {
            const box = view.current;
            if (box)
              follow.current =
                box.scrollHeight - box.scrollTop - box.clientHeight < 100;
          }}
        >
          {older && selected ? (
            <button
              className="secondary compact"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                follow.current = false;
                api(
                  `/manage/ai/conversations/${selected}?before=${String(older)}`,
                  aiTurnList,
                )
                  .then((r) => {
                    setTurns((items) => [...r.items, ...items]);
                    setOlder(r.next?.before ?? null);
                  })
                  .catch((e: unknown) => {
                    setError(ErrorMessage(e));
                  })
                  .finally(() => {
                    setLoading(false);
                  });
              }}
            >
              Load earlier messages
            </button>
          ) : null}
          {!turns.length ? (
            <div className="ai-welcome">
              <span className="brand-mark">H</span>
              <h2>
                {loading
                  ? 'Opening conversation…'
                  : 'What would you like to understand?'}
              </h2>
              <p>
                Ask about ad accounts, spend or campaign performance. Include
                the account and date range for a precise answer.
              </p>
            </div>
          ) : null}
          {turns.map((turn) => (
            <div className="ai-turn" key={turn.id}>
              <article className="ai-question" aria-label="Your message">
                {turn.question}
              </article>
              <article className="ai-answer" aria-label="AI response">
                <span className="ai-author">HEXA AI</span>
                {turn.answer ? (
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    skipHtml
                    components={{
                      a: ({ children, href }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {children}
                        </a>
                      ),
                      img: ({ alt }) => <span>{alt ?? '[image]'}</span>,
                    }}
                  >
                    {turn.answer}
                  </Markdown>
                ) : (
                  <p className="muted">
                    {turn.status === 'running'
                      ? busy
                        ? 'Working on your question…'
                        : 'A response is in progress. Refresh to check its result.'
                      : 'No answer saved.'}
                  </p>
                )}
                {turn.status === 'complete' ? (
                  <button
                    className="secondary compact"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(turn.answer)
                        .then(() => {
                          setCopied(turn.id);
                        })
                        .catch(() => {
                          setError(
                            'Copy is unavailable in this browser. Select the response text to copy it.',
                          );
                        });
                    }}
                  >
                    {copied === turn.id ? 'Copied' : 'Copy response'}
                  </button>
                ) : null}
                {turn.status === 'error' || turn.status === 'cancelled' ? (
                  <small className="muted">
                    {turn.status === 'cancelled' ? 'Stopped' : 'Not completed'}
                  </small>
                ) : null}
              </article>
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="ai-composer-area">
          {error ? <Alert>{error}</Alert> : null}
          <p className="caption ai-activity" role="status">
            {activity ||
              'AI can make mistakes. Verify important figures against Meta.'}
          </p>
          <form
            className="ai-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send().catch((reason: unknown) => {
                setError(ErrorMessage(reason));
              });
            }}
          >
            <label className="sr-only" htmlFor="ai-message">
              Message
            </label>
            <textarea
              id="ai-message"
              placeholder="Ask a question about your Meta advertising…"
              value={draft}
              maxLength={8000}
              rows={2}
              disabled={configured !== true || busy || loading || serverRunning}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            {busy ? (
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  stop().catch((e: unknown) => {
                    setError(ErrorMessage(e));
                  });
                }}
              >
                Stop
              </button>
            ) : (
              <button
                className="primary"
                disabled={
                  !draft.trim() ||
                  configured !== true ||
                  loading ||
                  serverRunning
                }
              >
                Send
              </button>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}
