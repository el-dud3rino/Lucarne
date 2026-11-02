type SSEClient = {
  id: string;
  send: (chunk: string) => void;
};

const clients = new Map<string, SSEClient>();

export type RealtimeTopic =
  | 'family'
  | 'events'
  | 'chores'
  | 'lists'
  | 'meals'
  | 'recipes'
  | 'photos'
  | 'settings';

export function registerSSEClient(id: string, send: (chunk: string) => void): () => void {
  clients.set(id, { id, send });
  return () => {
    clients.delete(id);
  };
}

export function broadcastInvalidate(topics: RealtimeTopic[]): void {
  const payload = JSON.stringify({ type: 'invalidate', topics, ts: Date.now() });
  const msg = `data: ${payload}\n\n`;
  for (const [id, client] of clients.entries()) {
    try {
      client.send(msg);
    } catch {
      clients.delete(id);
    }
  }
}

// Keep connections alive through proxies / routers every 25s
setInterval(() => {
  const ping = `: keepalive ${Date.now()}\n\n`;
  for (const [id, client] of clients.entries()) {
    try {
      client.send(ping);
    } catch {
      clients.delete(id);
    }
  }
}, 25_000).unref();
