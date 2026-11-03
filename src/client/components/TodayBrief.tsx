import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Car, CalendarDays, Utensils } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { toDateStr, formatTimeShort } from '../lib/dates.js';
import { useDailyForecast } from '../lib/weather.js';
import { useToday } from './TodayBar.js';
import { daysLeftLabel } from './Countdowns.js';
import { computeLeaveAlerts, leaveLabel, weatherHint } from '../../shared/leaveBy.js';
import type { AppSettings, FamilyMember } from '../../shared/types.js';

/**
 * Glanceable "today" card for the photo frame: what's left today, when to leave, what's for dinner,
 * who still has chores, countdowns and a clothing hint from the forecast.
 */
export const TodayBrief: React.FC<{ settings: AppSettings; active: boolean }> = ({ settings, active }) => {
  const { data } = useToday(undefined, active);
  const { data: members = [] } = useQuery({ queryKey: ['family'], queryFn: () => apiFetch<FamilyMember[]>('/api/family'), enabled: active });
  const { data: forecast } = useDailyForecast(settings.weatherLat, settings.weatherLon, settings.weatherUnit);
  if (!data) return null;

  const now = Date.now();
  const byId = new Map(members.map((m) => [m.id, m]));
  const upcoming = data.events
    .filter((e) => (e.allDay ? true : Date.parse(e.endIso) > now))
    .filter((e) => !e.category || (e.category === 'birthday' ? settings.showBirthdays : settings.showHolidays))
    .slice(0, 5);
  const leave = computeLeaveAlerts(data.events, now)[0];
  const hint = weatherHint(forecast?.get(toDateStr(new Date())), settings.weatherUnit);
  const choresLeft = data.choresLeft.filter((c) => c.left > 0);

  if (upcoming.length === 0 && !data.dinner && choresLeft.length === 0 && data.countdowns.length === 0 && !hint) return null;

  return (
    <div className="bg-black/50 backdrop-blur-md border border-white/15 rounded-3xl px-5 py-4 w-[420px] max-w-[42vw] space-y-3 text-white" data-testid="today-brief">
      {leave && (
        <div className={`rounded-2xl px-3.5 py-2 flex items-center gap-2.5 ${leave.status === 'soon' ? 'bg-amber-400/25' : 'bg-rose-500/35'}`}>
          <Car className="w-5 h-5 shrink-0" />
          <div className="min-w-0">
            <div className="font-extrabold">{leaveLabel(leave)}</div>
            <div className="text-sm text-white/80 truncate">
              {leave.event.title} at {formatTimeShort(leave.event.startIso)}
            </div>
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" /> Today
          </div>
          {upcoming.map((e) => {
            const m = e.memberIds[0] ? byId.get(e.memberIds[0]) : undefined;
            return (
              <div key={e.id} className="flex items-center gap-2.5 text-base">
                <span className="w-1.5 h-6 rounded-full shrink-0" style={{ backgroundColor: m?.colorAccent ?? '#94A3B8' }} />
                <span className="w-[72px] shrink-0 text-sm font-bold text-white/70">{e.allDay ? 'All day' : formatTimeShort(e.startIso)}</span>
                <span className="font-bold truncate">{e.title}</span>
              </div>
            );
          })}
        </div>
      )}

      {data.dinner && (
        <div className="flex items-center gap-2.5">
          <Utensils className="w-4 h-4 text-amber-300 shrink-0" />
          <span className="text-sm text-white/70 font-bold">Dinner</span>
          <span className="font-bold truncate">{data.dinner.title}</span>
        </div>
      )}

      {choresLeft.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-white/70 font-bold mr-1">Chores left</span>
          {choresLeft.map((c) => {
            const m = byId.get(c.memberId);
            return (
              <span key={c.memberId} className="px-2 py-0.5 rounded-full text-sm font-extrabold" style={{ backgroundColor: m?.colorAccent ?? '#475569' }}>
                {m?.emoji} {c.left}
              </span>
            );
          })}
        </div>
      )}

      {data.countdowns.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.countdowns.slice(0, 3).map((c) => (
            <span key={c.id} className="px-2.5 py-1 rounded-xl bg-white/15 text-sm font-bold">
              {c.emoji} {c.title} · <span className="text-amber-300">{daysLeftLabel(c.daysLeft)}</span>
            </span>
          ))}
        </div>
      )}

      {hint && <div className="text-sm font-bold text-sky-200">{hint}</div>}
    </div>
  );
};
