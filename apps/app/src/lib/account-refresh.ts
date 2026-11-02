import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';

const source = crypto.randomUUID();
const name = 'hexa-account-changes';
function openChannel() {
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(name);
  } catch {
    return null;
  }
}

export function notifyAccountChange() {
  const channel = openChannel();
  try {
    channel?.postMessage(source);
  } finally {
    channel?.close();
  }
}

export function useAccountRefresh(update: Dispatch<SetStateAction<number>>) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        update((value) => value + 1);
      }, 100);
    };
    const channel = openChannel();
    if (channel)
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data !== source) refresh();
      };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [update]);
}
