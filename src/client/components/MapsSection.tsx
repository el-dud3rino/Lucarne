import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, House, KeyRound, MapPin } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { PlaceInput } from './PlaceInput.js';
import type { AppSettings } from '../../shared/types.js';

/**
 * Settings → Maps & drive times: the Google Maps key, the home address drive times start from, and a
 * test lookup so setup problems (API not enabled, billing off) show up here and not silently later.
 */
export const MapsSection: React.FC<{ settings: AppSettings }> = ({ settings }) => {
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [home, setHome] = useState(settings.homeAddress || '');
  // Settings arrive after first render (and can change from a phone): follow them unless mid-edit.
  const savedHome = useRef(settings.homeAddress || '');
  useEffect(() => {
    const next = settings.homeAddress || '';
    setHome((cur) => (cur === savedHome.current ? next : cur));
    savedHome.current = next;
  }, [settings.homeAddress]);
  const [testDest, setTestDest] = useState('');
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const configured = Boolean(settings.mapsApiKeyConfigured);

  const { data: status } = useQuery({
    queryKey: ['settings', 'maps-status'],
    queryFn: () => apiFetch<{ configured: boolean; homeAddress: string; lastError: string | null }>('/api/maps/status'),
  });

  const save = useMutation({
    mutationFn: (patch: Record<string, string>) => apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
    onError: (err) => setResult({ text: (err as Error).message, ok: false }),
  });

  const test = useMutation({
    mutationFn: (destination: string) =>
      apiFetch<{ minutes: number | null }>('/api/maps/test', { method: 'POST', body: JSON.stringify({ destination }) }),
    onSuccess: (r) => setResult({ text: `✓ Works: ${r.minutes} min drive from home right now.`, ok: true }),
    onError: (err) => setResult({ text: (err as Error).message, ok: false }),
  });

  return (
    <section className="bg-white rounded-3xl border border-stone-200 p-5 space-y-4 shadow-2xs" data-testid="maps-settings">
      <div>
        <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
          <Car className="w-5 h-5 text-sky-600" />
          Maps & drive times
        </h3>
        <p className="text-xs text-stone-500 font-medium mt-1">
          With a Google Maps key, event locations get place search, and every upcoming event with a full address
          (including ones synced from Google Calendar) gets a drive time from home with predicted traffic. That
          powers the "Leave in 10 min" banner. A drive time you pick on an event always wins.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1">
          <KeyRound className="w-3.5 h-3.5" /> Google Maps API key
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={configured ? 'Maps key saved ✓ (paste a new one to replace)' : 'Paste AIza... Maps API key'}
            className="flex-1 h-10 min-h-[40px] px-3 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono"
          />
          <button
            type="button"
            disabled={!key.trim()}
            onClick={() => {
              save.mutate({ googleMapsApiKey: key.trim() });
              setKey('');
            }}
            className="px-4 h-10 min-h-[40px] rounded-xl bg-slate-800 text-white text-xs font-bold disabled:opacity-40"
          >
            Save key
          </button>
          {configured && (
            <button
              type="button"
              onClick={() => save.mutate({ googleMapsApiKey: '' })}
              className="px-3 h-10 min-h-[40px] rounded-xl bg-stone-100 text-slate-600 text-xs font-bold"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1">
          <House className="w-3.5 h-3.5" /> Home address (drive times start here)
        </label>
        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <PlaceInput
              value={home}
              onChange={setHome}
              enabled={configured}
              placeholder="123 Main St, Springfield, IL 62701"
              className="w-full h-10 min-h-[40px] px-3 rounded-xl bg-stone-50 border border-stone-200 text-sm font-medium"
              testId="home-address"
            />
          </div>
          <button
            type="button"
            disabled={home.trim() === (settings.homeAddress || '')}
            onClick={() => save.mutate({ homeAddress: home.trim() })}
            className="px-4 h-10 min-h-[40px] rounded-xl bg-slate-800 text-white text-xs font-bold disabled:opacity-40"
          >
            Save home
          </button>
        </div>
        <p className="text-[11px] text-stone-400">Stays on this Lucarne; it's only sent to Google to work out routes.</p>
      </div>

      {configured && settings.homeAddress && (
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" /> Test a drive time
          </label>
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <PlaceInput
                value={testDest}
                onChange={setTestDest}
                enabled
                placeholder="Search a place, e.g. Publix"
                className="w-full h-10 min-h-[40px] px-3 rounded-xl bg-stone-50 border border-stone-200 text-sm font-medium"
              />
            </div>
            <button
              type="button"
              disabled={!testDest.trim() || test.isPending}
              onClick={() => test.mutate(testDest.trim())}
              className="px-4 h-10 min-h-[40px] rounded-xl bg-sky-600 text-white text-xs font-bold disabled:opacity-40"
            >
              {test.isPending ? 'Checking…' : 'Test'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`text-sm font-semibold ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{result.text}</div>
      )}
      {!result && status?.lastError && <div className="text-sm font-semibold text-rose-700">{status.lastError}</div>}
    </section>
  );
};
