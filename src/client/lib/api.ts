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

    const connect = () => {
      if (unmounted) return;
      es = new EventSource('/api/stream');

      es.onopen = () => {
        setConnected(true);
      };

      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { type: string; topics?: string[] };
          if (msg.type === 'invalidate' && Array.isArray(msg.topics)) {
            for (const topic of msg.topics) {
              queryClient.invalidateQueries({ queryKey: [topic] });
            }
          }
        } catch {
          // ignore malformed event
        }
      };

      es.onerror = () => {
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
