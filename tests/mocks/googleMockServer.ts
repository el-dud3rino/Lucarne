import http from 'node:http';
import { URL } from 'node:url';

export interface MockEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  status?: string;
}

export interface MockCalendar {
  id: string;
  summary: string;
  accessRole: string;
  primary?: boolean;
}

export interface MockPhotoItem {
  id: string;
  type?: 'PHOTO' | 'VIDEO';
  mediaFile: {
    baseUrl: string;
    mediaFileMetadata?: {
      width?: number;
      height?: number;
    };
  };
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body?: string;
}

// 1x1 valid minimal JPEG buffer
export const MINIMAL_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
  0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0xbf, 0x00, 0xff, 0xd9
]);

export class MockGoogleServer {
  private server: http.Server | null = null;
  private port = 0;
  private baseUrl = '';

  public isOffline = false;
  public syncTokenExpired = false;
  public currentSyncToken = 'token_initial_100';
  public nextSyncToken = 'token_next_200';

  public recordedRequests: RecordedRequest[] = [];
  public userProfiles: Map<string, { email: string; name: string; picture: string }> = new Map();
  public calendars: MockCalendar[] = [];
  public eventsByCalendar: Map<string, MockEvent[]> = new Map();

  // Photos Picker state
  public photosSessions: Map<string, { mediaItemsSet: boolean }> = new Map();
  public pickedPhotos: MockPhotoItem[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.isOffline = false;
    this.syncTokenExpired = false;
    this.currentSyncToken = 'token_initial_100';
    this.nextSyncToken = 'token_next_200';
    this.recordedRequests = [];
    this.userProfiles.clear();
    this.calendars = [
      { id: 'primary', summary: 'Primary Calendar', accessRole: 'owner', primary: true },
      { id: 'cal_work', summary: 'Work Schedule', accessRole: 'writer', primary: false },
      { id: 'cal_sports', summary: 'Kids Sports', accessRole: 'reader', primary: false },
    ];
    this.eventsByCalendar.clear();
    this.eventsByCalendar.set('primary', [
      {
        id: 'g_event_1',
        summary: 'Dentist Appointment',
        description: 'Routine checkup',
        location: 'Downtown Health',
        start: { dateTime: '2026-11-01T10:00:00Z' },
        end: { dateTime: '2026-11-01T11:00:00Z' },
        status: 'confirmed',
      },
      {
        id: 'g_event_2',
        summary: 'School Play',
        description: 'Elementary auditorium',
        location: 'Main School',
        start: { date: '2026-11-02' },
        end: { date: '2026-11-03' },
        status: 'confirmed',
      },
    ]);
    this.photosSessions.clear();
    this.pickedPhotos = [];
  }

  public async start(preferredPort = 0): Promise<string> {
    if (this.server) return this.baseUrl;

    this.server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        this.recordedRequests.push({
          method: req.method || 'GET',
          url: req.url || '/',
          headers: req.headers,
          body,
        });

        this.handleRequest(req, res, body);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(preferredPort, '127.0.0.1', () => {
        const address = this.server!.address();
        if (typeof address === 'object' && address !== null) {
          this.port = address.port;
          this.baseUrl = `http://127.0.0.1:${this.port}`;
          resolve();
        } else {
          reject(new Error('Failed to obtain server address'));
        }
      });
    });

    return this.baseUrl;
  }

  public async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse, rawBody: string): void {
    const parsedUrl = new URL(req.url || '/', this.baseUrl);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase();

    // Check simulated offline condition (503 Service Unavailable)
    // Keep OAuth /token alive unless specifically simulating server-wide outage
    if (this.isOffline && !pathname.includes('/token') && !pathname.includes('/health')) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 503, message: 'Google Service Unavailable (Simulated Offline)' } }));
      return;
    }

    // Health / Ping
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', port: this.port }));
      return;
    }

    // OAuth Token Revocation: /revoke
    if (pathname === '/revoke') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // 1. OAuth 2.0 Token Endpoint: POST /token
    if (pathname === '/token' && method === 'POST') {
      const params = new URLSearchParams(rawBody);
      const code = params.get('code') || '';
      const refreshToken = params.get('refresh_token') || '';
      const grantType = params.get('grant_type') || '';

      const accountId = code.includes('user2') || refreshToken.includes('user2') ? 'user2' : 'user1';
      const token = `mock_access_token_${accountId}_${Date.now()}`;
      const refresh = refreshToken || `mock_refresh_token_${accountId}`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: token,
          refresh_token: refresh,
          expires_in: 3600,
          token_type: 'Bearer',
        })
      );
      return;
    }

    // 2. User Info: GET /oauth2/v2/userinfo
    if (pathname === '/oauth2/v2/userinfo' && method === 'GET') {
      const auth = req.headers.authorization || '';
      const isUser2 = auth.includes('user2');
      const profile = isUser2
        ? {
            email: 'parent2@example.com',
            name: 'Mom Example',
            picture: `${this.baseUrl}/media/avatar2.jpg`,
          }
        : {
            email: 'parent1@example.com',
            name: 'Dad Example',
            picture: `${this.baseUrl}/media/avatar1.jpg`,
          };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(profile));
      return;
    }

    // 3. Calendar List: GET /calendar/v3/users/me/calendarList
    if ((pathname.endsWith('/calendarList') || pathname.endsWith('/calendarList/')) && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ kind: 'calendar#calendarList', items: this.calendars }));
      return;
    }

    // 4. Events Collection: /calendar/v3/calendars/:calendarId/events
    const eventsMatch = pathname.match(/\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?/);
    if (eventsMatch) {
      const calId = decodeURIComponent(eventsMatch[1]);
      const eventId = eventsMatch[2] ? decodeURIComponent(eventsMatch[2]) : null;

      if (!this.eventsByCalendar.has(calId)) {
        this.eventsByCalendar.set(calId, []);
      }
      const calEvents = this.eventsByCalendar.get(calId)!;

      // GET /events (list or incremental sync)
      if (method === 'GET' && !eventId) {
        const syncToken = parsedUrl.searchParams.get('syncToken');
        if (syncToken && (syncToken === 'expired-token' || this.syncTokenExpired)) {
          res.writeHead(410, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 410, message: 'Sync token expired (Simulated 410 Gone)' } }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            kind: 'calendar#events',
            nextSyncToken: this.nextSyncToken,
            items: calEvents,
          })
        );
        return;
      }

      // POST /events (create event)
      if (method === 'POST' && !eventId) {
        const bodyObj = JSON.parse(rawBody || '{}');
        const newEvent: MockEvent = {
          id: `mock_evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          summary: bodyObj.summary || 'Untitled Event',
          description: bodyObj.description || '',
          location: bodyObj.location || '',
          start: bodyObj.start || { dateTime: new Date().toISOString() },
          end: bodyObj.end || { dateTime: new Date().toISOString() },
          status: 'confirmed',
        };
        calEvents.push(newEvent);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newEvent));
        return;
      }

      // PUT /events/:eventId (update event)
      if (method === 'PUT' && eventId) {
        const bodyObj = JSON.parse(rawBody || '{}');
        let existing = calEvents.find((e) => e.id === eventId);
        if (!existing) {
          existing = { id: eventId, summary: '', start: {}, end: {} };
          calEvents.push(existing);
        }
        Object.assign(existing, bodyObj);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(existing));
        return;
      }

      // DELETE /events/:eventId
      if (method === 'DELETE' && eventId) {
        const idx = calEvents.findIndex((e) => e.id === eventId);
        if (idx !== -1) {
          calEvents.splice(idx, 1);
        }
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // 5. Photos Picker 2025+ API
    // POST /v1/sessions
    if (pathname === '/v1/sessions' && method === 'POST') {
      const sessionId = `photos_sess_${Date.now()}`;
      this.photosSessions.set(sessionId, { mediaItemsSet: false });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: sessionId,
          pickerUri: `${this.baseUrl}/picker-ui/${sessionId}`,
        })
      );
      return;
    }

    // GET /v1/sessions/:id
    const sessionMatch = pathname.match(/\/v1\/sessions\/([^/]+)/);
    if (sessionMatch && method === 'GET') {
      const sessId = sessionMatch[1];
      const sess = this.photosSessions.get(sessId) || { mediaItemsSet: true };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: sessId, mediaItemsSet: sess.mediaItemsSet }));
      return;
    }

    // GET /v1/mediaItems
    if (pathname === '/v1/mediaItems' && method === 'GET') {
      const items = this.pickedPhotos.length > 0 ? this.pickedPhotos : [
        {
          id: 'gphoto_landscape_1',
          mediaFile: {
            baseUrl: `${this.baseUrl}/media/landscape_sample`,
            mediaFileMetadata: { width: 1920, height: 1080 },
          },
        },
        {
          id: 'gphoto_portrait_1',
          mediaFile: {
            baseUrl: `${this.baseUrl}/media/portrait_sample`,
            mediaFileMetadata: { width: 1080, height: 1920 },
          },
        },
      ];

      // Paginate like Google (pageSize / opaque pageToken) so album-sized imports are exercised.
      const pageSize = Math.max(1, Number(parsedUrl.searchParams.get('pageSize')) || 25);
      const offset = Number(parsedUrl.searchParams.get('pageToken') || 0) || 0;
      const page = items.slice(offset, offset + pageSize);
      const next = offset + pageSize < items.length ? String(offset + pageSize) : undefined;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mediaItems: page, ...(next ? { nextPageToken: next } : {}) }));
      return;
    }

    // 6. Media download endpoints (e.g. /media/landscape_sample=w1920-h1080)
    if (pathname.startsWith('/media/')) {
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': MINIMAL_JPEG.length,
      });
      res.end(MINIMAL_JPEG);
      return;
    }

    // 404 Not Found fallback
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Not found: ${method} ${pathname}` }));
  }
}
