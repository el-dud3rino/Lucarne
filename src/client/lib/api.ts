import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) errMsg = data.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }
  return res.json() as Promise<T>;
}

/** Queries computed from other data that must refresh along with it. */
const DERIVED_TOPICS: Record<string, string[]> = {
  chores: ['rewards'],
  routines: ['rewards'],
  events: ['health'],
  settings: ['health', 'feeds', 'backups'],
};

/**
 * Connects to /api/stream SSE bus and automatically reconciles TanStack Query caches
 * across the wall kiosk and all family phones on the LAN.
 */
export function useRealtimeSync(): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;
    let hadDisconnect = false;

    const connect = () => {
      if (unmounted) return;
      es = new EventSource('/api/stream');

      es.onopen = () => {
        setConnected(true);
        // Catch up on anything that changed while we were disconnected.
        if (hadDisconnect) queryClient.invalidateQueries();
        hadDisconnect = false;
      };

      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { type: string; topics?: string[] };
          if (msg.type === 'invalidate' && Array.isArray(msg.topics)) {
            const keys = new Set<string>(msg.topics);
            for (const topic of msg.topics) for (const extra of DERIVED_TOPICS[topic] ?? []) keys.add(extra);
            keys.add('today'); // the Today summary (brief, leave-by, kid mode) mixes everything
            for (const key of keys) {
              queryClient.invalidateQueries({ queryKey: [key] });
            }
          }
        } catch {
          // ignore malformed event
        }
      };

      es.onerror = () => {
        hadDisconnect = true;
        setConnected(false);
        es?.close();
        if (!unmounted) {
          retryTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    // Appliance uptime hygiene: scheduled 3:30 AM gentle soft-refresh when idle
    const hygieneInterval = setInterval(() => {
      const now = new Date();
      if (now.getHours() === 3 && now.getMinutes() === 30) {
        const activeTag = document.activeElement?.tagName;
        if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
          window.location.reload();
        }
      }
    }, 60_000);

    return () => {
      unmounted = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(hygieneInterval);
    };
  }, [queryClient]);

  return { connected };
}
