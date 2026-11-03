import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Car, CloudOff, WifiOff } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { toDateStr } from '../lib/dates.js';
import { computeLeaveAlerts, leaveLabel } from '../../shared/leaveBy.js';
import type { FamilyMember, TodaySummary } from '../../shared/types.js';

/** Today's summary (events, dinner, chores left, routines, countdowns). Refreshes live and every 5 minutes. */
export function useToday(memberId?: string, enabled = true) {
  const dateStr = toDateStr(new Date());
  return useQuery({
    queryKey: ['today', dateStr, memberId ?? 'all'],
    queryFn: () => apiFetch<TodaySummary>(`/api/today?date=${dateStr}${memberId ? `&memberId=${encodeURIComponent(memberId)}` : ''}`),
    refetchInterval: 5 * 60_000,
    staleTime: 30_000,
    enabled,
  });
}

/** Re-renders every `ms` so countdown-style labels stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "🚗 Leave in 12 min · Soccer at 5:30 · Dad driving" — shown on every screen when it's nearly time to go. */
export const LeaveBanner: React.FC<{ members: FamilyMember[] }> = ({ members }) => {
  const { data } = useToday();
  const now = useNow(20_000);
  const alerts = computeLeaveAlerts(data?.events ?? [], now);
  if (alerts.length === 0) return null;
  const byId = new Map(members.map((m) => [m.id, m]));
  return (
    <div className="shrink-0 px-3.5 md:px-5 pt-2.5 space-y-2" data-testid="leave-banner">
      {alerts.slice(0, 2).map((a) => {
        const driver = a.event.driverMemberId ? byId.get(a.event.driverMemberId) : undefined;
        const who = a.event.memberIds.map((id) => byId.get(id)).filter((m): m is FamilyMember => Boolean(m));
        const urgent = a.status !== 'soon';
        return (
          <div
            key={a.event.id}
            role="status"
            className={`rounded-2xl px-4 py-2.5 flex items-center gap-3 border shadow-2xs ${
              urgent ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-amber-50 border-amber-200 text-amber-950'
            }`}
          >
            <Car className={`w-6 h-6 shrink-0 ${urgent ? 'text-rose-600 animate-pulse' : 'text-amber-600'}`} />
            <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2">
              <span className="font-extrabold text-base md:text-lg">{leaveLabel(a)}</span>
              <span className="font-semibold text-sm truncate">
                {a.event.title} at {new Date(a.event.startIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                {a.event.location ? ` · ${a.event.location}` : ''}
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-1 shrink-0">
              {who.slice(0, 3).map((m) => (
                <span key={m.id} title={m.name} className="text-lg">
                  {m.emoji}
                </span>
              ))}
              {driver && <span className="ml-1 text-xs font-bold px-2 py-1 rounded-lg bg-white/80">{driver.name} driving</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface Health {
  sync?: {
    googleAccounts: number;
    googleLastSyncedAt: string | null;
    googleErrors: number;
    feeds: number;
    feedErrors: number;
  };
}

const STALE_MS = 20 * 60_000;

function timeLabel(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Small header chip that tells the family when they're looking at saved data:
 * - this screen lost the Lucarne server (phone off Wi-Fi, server restarting)
 * - Google hasn't synced for a while (internet down / account needs re-linking)
 * Nothing is shown when everything is fine.
 */
export const SyncStatusChip: React.FC<{ connected: boolean }> = ({ connected }) => {
  const [lostAt, setLostAt] = useState<number | null>(null);
  useEffect(() => {
    if (!connected) setLostAt((prev) => prev ?? Date.now());
    else setLostAt(null);
  }, [connected]);
  const now = useNow(5_000);
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<Health>('/api/health'),
    refetchInterval: 2 * 60_000,
    enabled: connected,
  });

  // Ignore blips: only after 8 s without the server.
  if (lostAt && now - lostAt > 8_000) {
    return (
      <span
        title="This screen can't reach Lucarne right now. It keeps showing what it last loaded and reconnects by itself."
        className="h-8 px-2.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-extrabold flex items-center gap-1.5 shrink-0"
      >
        <WifiOff className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Offline · saved data from {timeLabel(new Date(lostAt).toISOString())}</span>
        <span className="sm:hidden">Offline</span>
      </span>
    );
  }
  const s = health?.sync;
  if (!connected || !s) return null;
  const googleStale = s.googleAccounts > 0 && (s.googleErrors > 0 || !s.googleLastSyncedAt || now - Date.parse(s.googleLastSyncedAt) > STALE_MS);
  if (!googleStale && s.feedErrors === 0) return null;
  const label = googleStale ? `Google sync paused · last ${timeLabel(s.googleLastSyncedAt)}` : 'A calendar link failed to update';
  return (
    <span
      title={`${label}. The calendar still shows the last copy. Details are in Settings.`}
      className="h-8 px-2.5 rounded-full bg-stone-200/80 text-stone-700 text-[11px] font-bold flex items-center gap-1.5 shrink-0"
    >
      <CloudOff className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
};
