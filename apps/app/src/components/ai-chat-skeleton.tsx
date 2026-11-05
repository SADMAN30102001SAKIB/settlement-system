import { Skeleton } from './ui';

export function ChatHistorySkeleton() {
  return (
    <div
      className="ai-history-skeleton"
      role="status"
      aria-label="Loading chat history…"
    >
      <div aria-hidden="true">
        {[75, 90, 60].map((width) => (
          <Skeleton key={width} width={`${String(width)}%`} height={30} />
        ))}
      </div>
    </div>
  );
}

export function ChatMessagesSkeleton() {
  return (
    <div
      className="ai-messages-skeleton"
      role="status"
      aria-label="Loading conversation…"
    >
      <div className="ai-turn" aria-hidden="true">
        <Skeleton
          width="55%"
          height={44}
          radius={16}
          style={{ marginLeft: 'auto', marginBottom: 28 }}
        />
        <Skeleton width={70} height={10} style={{ marginBottom: 18 }} />
        <Skeleton width="85%" height={14} style={{ marginBottom: 12 }} />
        <Skeleton width="95%" height={14} style={{ marginBottom: 12 }} />
        <Skeleton width="65%" height={14} />
      </div>
    </div>
  );
}

export function AiChatSkeleton() {
  return (
    <section
      className="ai-chat ai-chat-skeleton"
      role="status"
      aria-label="Loading AI Chat…"
      aria-busy="true"
    >
      <aside className="ai-history" aria-hidden="true">
        <div className="ai-history-heading">
          <Skeleton width={70} height={20} />
          <Skeleton width={80} height={34} radius={8} />
        </div>
        <ChatHistorySkeleton />
      </aside>
      <div className="ai-thread" aria-hidden="true">
        <header className="ai-thread-heading">
          <div className="ai-skeleton-heading">
            <Skeleton width="70%" height={24} style={{ marginBottom: 10 }} />
            <Skeleton width="45%" height={10} />
          </div>
        </header>
        <div className="ai-messages">
          <ChatMessagesSkeleton />
        </div>
        <div className="ai-composer-area">
          <Skeleton width="65%" height={10} style={{ marginBottom: 10 }} />
          <div className="ai-composer">
            <Skeleton height={68} radius={8} style={{ flex: 1 }} />
            <Skeleton width={72} height={68} radius={8} />
          </div>
        </div>
      </div>
    </section>
  );
}
