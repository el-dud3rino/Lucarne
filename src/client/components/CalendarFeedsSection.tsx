import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { NoticeBanner } from './NoticeBanner.js';
import { MemberChips } from './Sheet.js';
import { CATEGORY_STYLES } from '../../shared/eventCategories.js';
import type { FamilyMember, IcsFeed } from '../../shared/types.js';

/**
 * Settings: read-only calendar links (.ics / webcal) — school districts, sports apps, a spouse's
 * iCloud or Outlook calendar, holiday calendars. Refreshed every 30 minutes.
 */
export const CalendarFeedsSection: React.FC<{ members: FamilyMember[] }> = ({ members }) => {
  const queryClient = useQueryClient();
  const { data: feeds = [] } = useQuery({ queryKey: ['feeds'], queryFn: () => apiFetch<IcsFeed[]>('/api/feeds') });
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['feeds'] });
    queryClient.invalidateQueries({ queryKey: ['events'] });
  };

  const add = useMutation({
    mutationFn: () => apiFetch<IcsFeed>('/api/feeds', { method: 'POST', body: JSON.stringify({ url, name, memberIds }) }),
    onSuccess: (f) => {
      refresh();
      setUrl('');
      setName('');
      setMemberIds([]);
      setError(null);
      setOk(f.syncError ? `Saved "${f.name}", but it didn't load: ${f.syncError}` : `Added "${f.name}" with ${f.eventCount} events.`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: Partial<IcsFeed> }) => apiFetch(`/api/feeds/${v.id}`, { method: 'PUT', body: JSON.stringify(v.patch) }),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const sync = useMutation({
    mutationFn: (id: string) => apiFetch<IcsFeed>(`/api/feeds/${id}/sync`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/feeds/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  return (
    <section className="bg-white rounded-3xl border border-stone-200 p-5 space-y-4 shadow-2xs" data-testid="calendar-feeds">
      <div>
        <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
          <Link2 className="w-5 h-5 text-teal-600" />
          Calendar Links (School, Sports, iCloud, Outlook)
        </h3>
        <p className="text-xs text-stone-500 mt-1">
          Paste any “subscribe” / .ics / webcal link. Events show on the calendar read-only and refresh every 30 minutes. Good for school
          calendars, TeamSnap or GameChanger schedules, or a family member's iCloud or Outlook calendar.
        </p>
      </div>
      {error && <NoticeBanner tone="error" text={error} onDismiss={() => setError(null)} />}
      {ok && <NoticeBanner tone="success" text={ok} onDismiss={() => setOk(null)} />}

      <div className="space-y-2">
        {feeds.map((f) => (
          <div key={f.id} className="p-3 rounded-2xl bg-stone-50 border border-stone-200 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-slate-800 truncate">{f.name}</div>
                <div className={`text-xs ${f.syncError ? 'text-rose-600 font-semibold' : 'text-stone-500'}`}>
                  {f.syncError
                    ? `Last update failed: ${f.syncError}`
                    : f.enabled
                    ? `${f.eventCount} events · updated ${f.lastSyncedAt ? new Date(f.lastSyncedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never'}`
                    : 'Turned off'}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-stone-600 min-h-[40px] cursor-pointer">
                <input type="checkbox" checked={f.enabled} onChange={(e) => update.mutate({ id: f.id, patch: { enabled: e.target.checked } })} className="w-5 h-5" />
                On
              </label>
              <button
                type="button"
                aria-label={`Refresh ${f.name}`}
                onClick={() => sync.mutate(f.id)}
                className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl bg-white border border-stone-200 flex items-center justify-center"
              >
                {sync.isPending && sync.variables === f.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </button>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => remove.mutate(f.id)}
                className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <MemberChips members={members} value={f.memberIds} onChange={(ids) => update.mutate({ id: f.id, patch: { memberIds: ids } })} />
            <div className="flex gap-2">
              {(['birthday', 'holiday'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={f.category === cat}
                  onClick={() => update.mutate({ id: f.id, patch: { category: f.category === cat ? null : cat } })}
                  className={`h-10 min-h-[40px] px-3 rounded-xl text-xs font-bold border ${f.category === cat ? 'bg-white shadow-2xs border-stone-300' : 'border-transparent text-stone-500'}`}
                >
                  {CATEGORY_STYLES[cat].icon} Treat as {CATEGORY_STYLES[cat].label.toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <form
        className="space-y-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) add.mutate();
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… or webcal://… calendar link"
          aria-label="Calendar link"
          inputMode="url"
          className="w-full h-11 min-h-[40px] px-3 rounded-xl bg-stone-50 border border-stone-200 text-sm font-mono"
        />
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional, e.g. Lincoln Elementary)"
            aria-label="Calendar name"
            className="flex-1 h-11 min-h-[40px] px-3 rounded-xl bg-stone-50 border border-stone-200 text-sm"
          />
          <button
            type="submit"
            disabled={!url.trim() || add.isPending}
            className="h-11 min-h-[40px] px-4 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-1.5"
          >
            {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
          </button>
        </div>
        <div className="text-xs font-bold text-stone-400">Whose events are these?</div>
        <MemberChips members={members} value={memberIds} onChange={setMemberIds} />
      </form>
    </section>
  );
};
