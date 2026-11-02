import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CloudSun,
  Database,
  Edit2,
  Image as ImageIcon,
  Keyboard,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  Smartphone,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { timeAgo } from '../lib/time.js';
import { EmojiPickerButton } from '../components/EmojiPicker.js';
import { SharedAlbumsSection } from '../components/SharedAlbumsSection.js';
import { CATEGORY_STYLES, EVENT_CATEGORIES, type EventCategory } from '../../shared/eventCategories.js';
import { CopyButton, Linkify, NoticeBanner, type NoticeTone } from '../components/NoticeBanner.js';
import { WeatherWidget } from '../components/WeatherWidget.js';
import { KeepSyncSection } from '../components/KeepSyncSection.js';
import {
  SKYLIGHT_COLOR_PRESETS,
  type AppSettings,
  type CalendarSource,
  type FamilyMember,
  type GoogleAccountInfo,
  type MemberRole,
  type PhotoItem,
} from '../../shared/types.js';

interface SettingsViewProps {
  settings: AppSettings;
  members: FamilyMember[];
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settings, members }) => {
  const queryClient = useQueryClient();

  // Local credential & status states
  const [clientId, setClientId] = useState(settings.googleClientId || '');
  const [clientSecret, setClientSecret] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: NoticeTone } | null>(null);
  /** Success/info notice; passing '' clears it (but never clears an error the user hasn't read). */
  const setStatusBanner = (text: string, tone: Exclude<NoticeTone, 'error'> = 'success') =>
    setBanner((prev) => (text ? { text, tone } : prev?.tone === 'error' ? prev : null));
  /** Errors stay until dismissed and can be copied. */
  const showError = (err: unknown, fallback = 'Something went wrong') =>
    setBanner({ text: err instanceof Error ? err.message : typeof err === 'string' ? err : fallback, tone: 'error' });

  // Weather state
  const [weatherCityInput, setWeatherCityInput] = useState(settings.weatherLocationName || '');

  // Photo delete confirmation state
  const [confirmDeletePhotoId, setConfirmDeletePhotoId] = useState<string | null>(null);

  // Google disconnect confirmation state
  const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(null);

  // Photo picker state
  const [pickerSession, setPickerSession] = useState<{
    accountId: string;
    sessionId: string;
    pickerUri: string;
  } | null>(null);
  const pickerStartedAt = useRef(0);

  // New family member form state
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmoji, setNewMemberEmoji] = useState('🙂');
  const [newMemberRole, setNewMemberRole] = useState<MemberRole>('child');
  const [presetIdx, setPresetIdx] = useState(0);

  // Edit family member modal state
  const [editingMember, setEditingMember] = useState<FamilyMember | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('🙂');
  const [editRole, setEditRole] = useState<MemberRole>('child');
  const [editPresetIdx, setEditPresetIdx] = useState(0);

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () =>
      apiFetch<{ ok: boolean; lanIps: string[]; hostname: string }>('/api/health'),
  });

  const { data: googleData } = useQuery({
    queryKey: ['settings', 'google'],
    queryFn: () =>
      apiFetch<{ accounts: GoogleAccountInfo[]; sources: CalendarSource[] }>(
        '/api/settings/google/accounts'
      ),
  });

  const { data: photos = [] } = useQuery({
    queryKey: ['photos'],
    queryFn: () => apiFetch<PhotoItem[]>('/api/photos'),
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (
      patch: Partial<AppSettings> & {
        googleClientSecret?: string;
        geminiApiKey?: string;
        nightModeBrightness?: number;
        weatherRefreshMinutes?: number;
      }
    ) =>
      apiFetch<AppSettings>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setStatusBanner('Settings saved.');
      setTimeout(() => setStatusBanner(''), 2500);
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      const preset = SKYLIGHT_COLOR_PRESETS[presetIdx] || SKYLIGHT_COLOR_PRESETS[0];
      return apiFetch('/api/family', {
        method: 'POST',
        body: JSON.stringify({
          name: newMemberName.trim(),
          emoji: newMemberEmoji,
          role: newMemberRole,
          colorBg: preset.colorBg,
          colorText: preset.colorText,
          colorAccent: preset.colorAccent,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['family'] });
      setNewMemberName('');
    },
  });

  const deleteMemberMutation = useMutation({
    mutationFn: async (id: string) => apiFetch(`/api/family/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['family'] }),
  });

  const updateMemberMutation = useMutation({
    mutationFn: async (vars: { id: string; data: Partial<FamilyMember> }) =>
      apiFetch(`/api/settings/members/${vars.id}`, {
        method: 'PUT',
        body: JSON.stringify(vars.data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['family'] });
      setEditingMember(null);
      setStatusBanner('Member profile updated.');
      setTimeout(() => setStatusBanner(''), 2500);
    },
  });

  const reorderMembersMutation = useMutation({
    mutationFn: async (order: string[]) =>
      apiFetch('/api/settings/members/reorder', {
        method: 'PUT',
        body: JSON.stringify({ order }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['family'] });
    },
  });

  const moveMember = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= members.length) return;
    const reordered = [...members];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    reorderMembersMutation.mutate(reordered.map((m) => m.id));
  };

  const openEditModal = (member: FamilyMember) => {
    setEditingMember(member);
    setEditName(member.name);
    setEditEmoji(member.emoji);
    setEditRole(member.role);
    const pIdx = SKYLIGHT_COLOR_PRESETS.findIndex((p) => p.colorBg === member.colorBg);
    setEditPresetIdx(pIdx >= 0 ? pIdx : 0);
  };

  const saveEditMember = () => {
    if (!editingMember || !editName.trim()) return;
    const preset = SKYLIGHT_COLOR_PRESETS[editPresetIdx] || SKYLIGHT_COLOR_PRESETS[0];
    updateMemberMutation.mutate({
      id: editingMember.id,
      data: {
        name: editName.trim(),
        emoji: editEmoji,
        role: editRole,
        colorBg: preset.colorBg,
        colorText: preset.colorText,
        colorAccent: preset.colorAccent,
      },
    });
  };

  const deletePhotoMutation = useMutation({
    mutationFn: async (id: string) => apiFetch(`/api/photos/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      setConfirmDeletePhotoId(null);
      setStatusBanner('Photo removed from screensaver.');
      setTimeout(() => setStatusBanner(''), 2500);
    },
  });

  const disconnectGoogleMutation = useMutation({
    mutationFn: async (accountId: string) =>
      apiFetch('/api/settings/disconnect-google', {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setConfirmDisconnectId(null);
      setStatusBanner('Google account cleanly disconnected and revoked.');
      setTimeout(() => setStatusBanner(''), 3000);
    },
  });

  const updateSourceMutation = useMutation({
    mutationFn: async (vars: { id: string; enabled?: boolean; memberIds?: string[]; category?: EventCategory | null }) =>
      apiFetch(`/api/settings/google/sources/${vars.id}`, {
        method: 'PUT',
        body: JSON.stringify(vars),
      }),
    // Instant feedback on the wall: update the row before the server answers.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['settings', 'google'] });
      const previous = queryClient.getQueryData<{ accounts: GoogleAccountInfo[]; sources: CalendarSource[] }>([
        'settings',
        'google',
      ]);
      if (previous) {
        queryClient.setQueryData(['settings', 'google'], {
          ...previous,
          sources: previous.sources.map((s) =>
            s.id === vars.id
              ? {
                  ...s,
                  ...(vars.enabled !== undefined ? { enabled: vars.enabled } : {}),
                  ...(vars.memberIds !== undefined ? { memberIds: vars.memberIds } : {}),
                  ...(vars.category !== undefined ? { category: vars.category } : {}),
                }
              : s
          ),
        });
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['settings', 'google'], ctx.previous);
      showError(err instanceof Error ? `Could not save calendar change: ${err.message}` : 'Could not save calendar change');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const calendarSyncMutation = useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        accounts: number;
        synced: number;
        eventCount: number;
        failed: Array<{ calendar: string; account: string; message: string }>;
      }>('/api/settings/google/sync-now', { method: 'POST' }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const toggleSourceMember = (src: CalendarSource, memberId: string) => {
    const memberIds = src.memberIds.includes(memberId)
      ? src.memberIds.filter((id) => id !== memberId)
      : [...src.memberIds, memberId];
    updateSourceMutation.mutate({ id: src.id, memberIds });
  };

  const lastCalendarSync = (googleData?.accounts ?? [])
    .map((a) => a.lastSyncedAt)
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop();

  const connectGoogleAccount = async () => {
    try {
      const { url } = await apiFetch<{ url: string }>('/api/settings/google/auth-url');
      window.location.href = url;
    } catch (err) {
      showError(err, 'Configure the Google Client ID first');
    }
  };

  const startGooglePhotosPicker = async (accountId: string) => {
    try {
      const s = await apiFetch<{ sessionId: string; pickerUri: string }>(
        '/api/photos/picker/start',
        {
          method: 'POST',
          body: JSON.stringify({ accountId }),
        }
      );
      setPickerSession({ accountId, ...s });
      pickerStartedAt.current = Date.now();
      setStatusBanner(
        'Pick photos in the Google Photos tab, then tap Done there. To add a whole album, search for the album name in the picker and select all of its photos. Lucarne imports them automatically when you finish.',
        'info'
      );
      // "/autoclose" closes Google's tab automatically after the user taps Done.
      window.open(`${s.pickerUri.replace(/\/$/, '')}/autoclose`, '_blank');
    } catch (err) {
      showError(err, 'Could not open the Google Photos picker');
    }
  };

  /** Returns the suggested wait before the next check, or null when the session is finished. */
  const checkPickerDone = async (manual = false): Promise<number | null> => {
    if (!pickerSession) return null;
    try {
      const res = await apiFetch<{
        ready: boolean;
        importedCount: number;
        alreadyHadCount: number;
        skippedVideoCount: number;
        failedCount: number;
        pollIntervalMs?: number;
      }>('/api/photos/picker/poll', {
        method: 'POST',
        body: JSON.stringify({ accountId: pickerSession.accountId, sessionId: pickerSession.sessionId }),
      });
      if (!res.ready) {
        if (manual) setStatusBanner('Still waiting: finish picking in the Google Photos tab and tap Done.', 'info');
        return res.pollIntervalMs ?? 4000;
      }
      setPickerSession(null);
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      const parts = [`Imported ${res.importedCount} photo${res.importedCount === 1 ? '' : 's'}`];
      if (res.alreadyHadCount) parts.push(`${res.alreadyHadCount} already in the gallery`);
      if (res.skippedVideoCount) parts.push(`${res.skippedVideoCount} video${res.skippedVideoCount === 1 ? '' : 's'} skipped`);
      if (res.failedCount) {
        parts.push(`${res.failedCount} failed to download`);
        showError(`${parts.join(' · ')}. Try importing the failed ones again.`);
      } else {
        setStatusBanner(parts.join(' · '));
      }
      return null;
    } catch (err) {
      setPickerSession(null);
      showError(err, 'Photo import failed');
      return null;
    }
  };

  // Poll the picker session automatically while the user picks (up to 20 minutes).
  useEffect(() => {
    if (!pickerSession) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - pickerStartedAt.current > 20 * 60_000) {
        setPickerSession(null);
        showError('Photo picking timed out after 20 minutes. Start the import again when ready.');
        return;
      }
      const next = await checkPickerDone();
      if (!cancelled && next !== null) timer = setTimeout(tick, Math.max(2000, Math.min(next, 10_000)));
    };
    timer = setTimeout(tick, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerSession]);

  const handlePhotoUpload = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = async () => {
        const orientation = img.height > img.width ? 'portrait' : 'landscape';
        try {
          await apiFetch('/api/photos/upload', {
            method: 'POST',
            body: JSON.stringify({ dataUrl, orientation }),
          });
        } catch (err) {
          showError(err, 'Photo upload failed');
          return;
        }
        queryClient.invalidateQueries({ queryKey: ['photos'] });
        setStatusBanner('Photo uploaded to screensaver.');
        setTimeout(() => setStatusBanner(''), 2500);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const triggerBackup = async () => {
    try {
      await apiFetch('/api/settings/backup', { method: 'POST' });
    } catch (err) {
      showError(err, 'Backup failed');
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['settings'] });
    setStatusBanner('SQLite snapshot saved to data/backups/!');
    setTimeout(() => setStatusBanner(''), 3000);
  };

  const currentBrightness =
    (settings as { nightModeBrightness?: number }).nightModeBrightness ?? 25;
  const currentRefreshMin =
    (settings as { weatherRefreshMinutes?: number }).weatherRefreshMinutes ?? 30;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden pr-1 space-y-5 pb-16">
      {banner && (
        <div className="sticky top-0 z-20">
          <NoticeBanner text={banner.text} tone={banner.tone} onDismiss={() => setBanner(null)} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 1. Appliance & Kiosk Display Settings */}
        <section className="bg-white rounded-3xl border border-stone-200 p-5 space-y-4 shadow-2xs">
          <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-sky-600" />
            Display, Touch Keyboard & Companion PWA
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
                Household Title
              </label>
              <input
                type="text"
                defaultValue={settings.familyName}
                onBlur={(e) =>
                  updateSettingsMutation.mutate({ familyName: e.target.value.trim() })
                }
                className="w-full h-11 px-3.5 rounded-xl bg-stone-50 border border-stone-200 font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
                Idle Screensaver Timeout
              </label>
              <select
                value={settings.screensaverIdleMinutes}
                onChange={(e) =>
                  updateSettingsMutation.mutate({
                    screensaverIdleMinutes: Number(e.target.value),
                  })
                }
                className="w-full h-11 min-h-[40px] px-3 rounded-xl bg-stone-50 border border-stone-200 font-bold"
              >
                <option value={0}>Disabled</option>
                <option value={2}>After 2 minutes</option>
                <option value={5}>After 5 minutes</option>
                <option value={10}>After 10 minutes</option>
                <option value={30}>After 30 minutes</option>
              </select>
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            <label className="flex items-center justify-between p-3 rounded-2xl bg-stone-50 border border-stone-200 cursor-pointer min-h-[44px]">
              <div>
                <div className="font-bold text-sm text-slate-800">
                  Built-In 1080p On-Screen Touch Keyboard
                </div>
                <div className="text-xs text-stone-500">
                  Auto-opens on wall screen; automatically disabled on mobile phones
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.kioskKeyboardEnabled}
                onChange={(e) =>
                  updateSettingsMutation.mutate({ kioskKeyboardEnabled: e.target.checked })
                }
                className="w-5 h-5 rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-2xl bg-stone-50 border border-stone-200 cursor-pointer min-h-[44px]">
              <div>
                <div className="font-bold text-sm text-slate-800">
                  Show Tonight’s Dinner Strip on Calendar
                </div>
                <div className="text-xs text-stone-500">
                  Displays planned dinner at the bottom of each day column
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.showDinnerOnCalendar}
                onChange={(e) =>
                  updateSettingsMutation.mutate({ showDinnerOnCalendar: e.target.checked })
                }
                className="w-5 h-5 rounded cursor-pointer"
              />
            </label>
          </div>

          {health?.lanIps && health.lanIps.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200/80 flex items-center gap-3">
              <Smartphone className="w-6 h-6 text-sky-600 shrink-0" />
              <div className="text-xs text-sky-950">
                <div className="font-extrabold">Phone Companion URL (Add to Home Screen):</div>
                <div className="font-mono mt-0.5">
                  http://{health.lanIps[0]}:{window.location.port || '3001'}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 2. Dedicated Night Mode Schedule Panel */}
        <section className="bg-white rounded-3xl border border-stone-200 p-5 space-y-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
              <Moon className="w-5 h-5 text-indigo-500" />
              Night Mode Schedule & Dimming
            </h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs font-bold text-slate-600">Enabled</span>
              <input
                type="checkbox"
                checked={settings.nightModeEnabled}
                onChange={(e) =>
                  updateSettingsMutation.mutate({ nightModeEnabled: e.target.checked })
                }
                className="w-5 h-5 rounded cursor-pointer"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
                Start Time
              </label>
              <input
                type="time"
                defaultValue={settings.nightModeStart || '22:00'}
                onChange={(e) =>
                  updateSettingsMutation.mutate({ nightModeStart: e.target.value })
                }
                className="w-full h-11 min-h-[40px] px-3.5 rounded-xl bg-stone-50 border border-stone-200 font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
                End Time
              </label>
              <input
                type="time"
                defaultValue={settings.nightModeEnd || '06:30'}
                onChange={(e) =>
                  updateSettingsMutation.mutate({ nightModeEnd: e.target.value })
                }
                className="w-full h-11 min-h-[40px] px-3.5 rounded-xl bg-stone-50 border border-stone-200 font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1.5">
              Night Behavior
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => updateSettingsMutation.mutate({ nightModeBehavior: 'dim' })}
                className={`flex-1 h-10 min-h-[40px] min-w-[120px] rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border ${
                  settings.nightModeBehavior === 'dim'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-stone-50 text-slate-700 border-stone-200 hover:bg-stone-100'
                }`}
              >
                Dim Photos
              </button>
              <button
                type="button"
                onClick={() => updateSettingsMutation.mutate({ nightModeBehavior: 'clock' })}
                className={`flex-1 h-10 min-h-[40px] min-w-[120px] rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border ${
                  settings.nightModeBehavior === 'clock'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-stone-50 text-slate-700 border-stone-200 hover:bg-stone-100'
                }`}
              >
                OLED Clock Only
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1.5">
              Dimming Brightness Level
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { val: 10, label: '10% (Ultra Dark)' },
                { val: 25, label: '25% (Soft Glow)' },
                { val: 50, label: '50% (Subdued)' },
              ].map((b) => (
                <button
                  key={b.val}
                  type="button"
                  onClick={() => updateSettingsMutation.mutate({ nightModeBrightness: b.val })}
                  className={`flex-1 h-10 min-h-[40px] min-w-[90px] rounded-xl font-bold text-xs flex items-center justify-center border ${
                    currentBrightness === b.val
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-stone-50 text-slate-700 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 3. Dedicated Weather Configuration Panel */}
        <section className="bg-white rounded-3xl border border-stone-200 p-5 space-y-4 shadow-2xs">
          <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
            <CloudSun className="w-5 h-5 text-amber-500" />
            Weather Configuration & Location
          </h3>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
              Household City / Location
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={weatherCityInput}
                onChange={(e) => setWeatherCityInput(e.target.value)}
                placeholder="City name (e.g. San Francisco, New York)..."
                className="flex-1 h-11 min-h-[40px] px-3.5 rounded-xl bg-stone-50 border border-stone-200 font-semibold text-sm"
              />
              <button
                type="button"
                onClick={() =>
                  updateSettingsMutation.mutate({
                    weatherLocationName: weatherCityInput.trim() || settings.weatherLocationName,
                  })
                }
                className="px-4 h-11 min-h-[40px] min-w-[40px] rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center"
              >
                Update
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1.5">
                Temperature Unit
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => updateSettingsMutation.mutate({ weatherUnit: 'F' })}
                  className={`flex-1 h-10 min-h-[40px] min-w-[60px] rounded-xl font-bold text-xs flex items-center justify-center border ${
                    settings.weatherUnit === 'F'
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-stone-50 text-slate-700 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  Fahrenheit (°F)
                </button>
                <button
                  type="button"
                  onClick={() => updateSettingsMutation.mutate({ weatherUnit: 'C' })}
                  className={`flex-1 h-10 min-h-[40px] min-w-[60px] rounded-xl font-bold text-xs flex items-center justify-center border ${
                    settings.weatherUnit === 'C'
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-stone-50 text-slate-700 border-stone-200 hover:bg-stone-100'
                  }`}
                >
                  Celsius (°C)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1.5">
                Refresh Cadence
              </label>
              <select
                value={currentRefreshMin}
                onChange={(e) =>
                  updateSettingsMutation.mutate({
                    weatherRefreshMinutes: Number(e.target.value),
                  })
                }
                className="w-full h-10 min-h-[40px] px-3 rounded-xl bg-stone-50 border border-stone-200 font-bold text-xs"
              >
                <option value={15}>Every 15 minutes</option>
                <option value={30}>Every 30 minutes</option>
                <option value={60}>Every 60 minutes</option>
              </select>
            </div>
          </div>

          {/* Embedded Live Weather Preview */}
          <div className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-200/60 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                Live Forecast Preview: {settings.weatherLocationName}
              </div>
              <div className="text-xs text-stone-500 mt-0.5">
                Coordinates: {settings.weatherLat.toFixed(2)}°, {settings.weatherLon.toFixed(2)}°
              </div>
            </div>
            <div className="text-slate-800 font-bold text-lg">
              <WeatherWidget
                lat={settings.weatherLat}
                lon={settings.weatherLon}
                unit={settings.weatherUnit}
              />
            </div>
          </div>
        </section>

        {/* 4. Photo Screensaver Gallery Management */}
        <section className="bg-white rounded-3xl border border-stone-200 p-5 space-y-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-amber-500" />
              Photo Screensaver Gallery
            </h3>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-stone-100 text-stone-700">
              {photos.length} photos active
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <label className="h-10 min-h-[40px] px-4 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-xs flex items-center gap-2 cursor-pointer min-w-[40px]">
              <Plus className="w-4 h-4" />
              Upload Local Photo
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePhotoUpload(f);
                }}
                className="hidden"
              />
            </label>

            {googleData?.accounts.map((acc) => (
              <button
                key={acc.id}
                type="button"
                onClick={() => startGooglePhotosPicker(acc.id)}
                className="h-10 min-h-[40px] px-3.5 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 font-bold text-xs min-w-[40px]"
              >
                Import from Google Photos ({acc.displayName || acc.email})
              </button>
            ))}

            {pickerSession && (
              <button
                type="button"
                onClick={() => checkPickerDone(true)}
                className="h-10 min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs min-w-[40px]"
              >
                Waiting for picks… check now
              </button>
            )}
          </div>

          <SharedAlbumsSection />

          {/* Individually added photos (album photos are managed per album above, to keep this grid light) */}
          {photos.some((p) => p.albumId) && (
            <div className="text-xs text-stone-500">
              {photos.filter((p) => p.albumId).length.toLocaleString()} photos come from shared albums.
              Individually added photos:
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
            {photos.filter((p) => !p.albumId).map((p) => (
              <div
                key={p.id}
                className="group relative rounded-2xl overflow-hidden border border-stone-200 bg-stone-100 aspect-video flex flex-col justify-between p-1.5 shadow-2xs"
              >
                <img
                  src={p.url}
                  alt={p.caption || 'Screensaver photo'}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="relative z-10 flex items-start justify-between">
                  <span className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-bold text-white uppercase tracking-wider">
                    {p.orientation === 'portrait' ? 'Portrait' : '16:9'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmDeletePhotoId === p.id) {
                        deletePhotoMutation.mutate(p.id);
                      } else {
                        setConfirmDeletePhotoId(p.id);
                      }
                    }}
                    className={`h-10 w-10 min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center transition-colors ${
                      confirmDeletePhotoId === p.id
                        ? 'bg-rose-600 text-white'
                        : 'bg-black/50 hover:bg-black/75 text-white'
                    }`}
                    title={confirmDeletePhotoId === p.id ? 'Click to confirm delete' : 'Delete photo'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {confirmDeletePhotoId === p.id && (
                  <div className="relative z-10 px-2 py-1 rounded bg-rose-700 text-[10px] font-bold text-white text-center">
                    Tap again to delete
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* 5. Multi-Account Google Calendar Sync & Disconnect */}
        <section className="bg-white rounded-3xl border border-stone-200 p-5 space-y-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-600" />
              Multi-Account Google Calendar Sync
            </h3>
            <button
              type="button"
              onClick={() => calendarSyncMutation.mutate()}
              disabled={calendarSyncMutation.isPending}
              className="h-10 min-h-[40px] min-w-[40px] px-3.5 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 disabled:opacity-70 text-xs font-bold flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${calendarSyncMutation.isPending ? 'animate-spin' : ''}`} />
              {calendarSyncMutation.isPending ? 'Syncing…' : 'Sync Now'}
            </button>
          </div>

          {/* Calendar sync status / result */}
          <div aria-live="polite" className="text-sm">
            {calendarSyncMutation.isPending ? (
              <div className="flex items-center gap-2 text-stone-500 font-semibold">
                <Loader2 className="w-4 h-4 animate-spin" /> Syncing calendars with Google…
              </div>
            ) : calendarSyncMutation.isError ? (
              <NoticeBanner text={`Sync failed: ${(calendarSyncMutation.error as Error).message}`} tone="error" />
            ) : calendarSyncMutation.data && calendarSyncMutation.data.failed.length > 0 ? (
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-rose-700 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {calendarSyncMutation.data.synced} synced, {calendarSyncMutation.data.failed.length} failed
                  </div>
                  <CopyButton
                    text={calendarSyncMutation.data.failed
                      .map((f) => `${f.calendar}${f.account ? ` (${f.account})` : ''}: ${f.message}`)
                      .join('\n')}
                  />
                </div>
                {calendarSyncMutation.data.failed.map((f, i) => (
                  <div key={i} className="text-xs select-text break-words">
                    <span className="font-bold">{f.calendar}</span>
                    {f.account ? ` (${f.account})` : ''}: <Linkify text={f.message} />
                  </div>
                ))}
              </div>
            ) : calendarSyncMutation.data ? (
              <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                {`Synced ${calendarSyncMutation.data.synced} calendar${calendarSyncMutation.data.synced === 1 ? '' : 's'} · ${calendarSyncMutation.data.eventCount} events · just now`}
              </div>
            ) : googleData?.accounts.length ? (
              <div className="text-stone-500">
                Syncs automatically every 90 seconds · last synced {timeAgo(lastCalendarSync)}
              </div>
            ) : null}
          </div>

          {/* Linked Google Accounts List with Disconnect Button */}
          {googleData?.accounts && googleData.accounts.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-stone-400">
                Connected Google Accounts
              </div>
              {googleData.accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="p-3 rounded-2xl bg-stone-50 border border-stone-200 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {acc.avatarUrl ? (
                      <img
                        src={acc.avatarUrl}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-sky-200 text-sky-800 flex items-center justify-center font-bold text-xs shrink-0">
                        {acc.displayName[0] || 'G'}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-slate-800 truncate">
                        {acc.displayName}
                      </div>
                      <div className="text-[11px] text-stone-500 truncate">
                        {acc.email} · synced {timeAgo(acc.lastSyncedAt)}
                      </div>
                      {acc.syncStatus === 'error' && acc.syncError && (
                        <div className="text-[11px] font-semibold text-rose-600 break-words select-text">
                          <Linkify text={acc.syncError} />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        acc.syncStatus === 'ok'
                          ? 'bg-emerald-100 text-emerald-800'
                          : acc.syncStatus === 'error'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-stone-200 text-stone-700'
                      }`}
                    >
                      {acc.syncStatus}
                    </span>

                    <button
                      type="button"
                      onClick={() => {
                        if (confirmDisconnectId === acc.id) {
                          disconnectGoogleMutation.mutate(acc.id);
                        } else {
                          setConfirmDisconnectId(acc.id);
                        }
                      }}
                      className={`h-10 min-h-[40px] min-w-[40px] px-3 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors ${
                        confirmDisconnectId === acc.id
                          ? 'bg-rose-600 text-white'
                          : 'bg-stone-100 hover:bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      {confirmDisconnectId === acc.id ? 'Confirm?' : 'Disconnect'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Google OAuth Client ID"
              className="h-10 min-h-[40px] px-3 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono"
            />
            <div className="flex gap-2">
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={
                  settings.googleClientSecretConfigured
                    ? 'Client Secret (Saved ✓)'
                    : 'Google OAuth Client Secret'
                }
                className="flex-1 h-10 min-h-[40px] px-3 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono"
              />
              <button
                type="button"
                onClick={() =>
                  updateSettingsMutation.mutate({
                    googleClientId: clientId,
                    googleClientSecret: clientSecret || undefined,
                  })
                }
                className="px-3.5 h-10 min-h-[40px] min-w-[40px] rounded-xl bg-slate-800 text-white text-xs font-bold"
              >
                Save
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={connectGoogleAccount}
            className="w-full h-11 min-h-[40px] rounded-2xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm min-w-[40px]"
          >
            + Link Google Account (Yours or Wife’s)
          </button>

          {/* Discovered calendars -> one or more family members */}
          {googleData && googleData.sources.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-stone-100">
              <div className="text-xs font-bold uppercase tracking-wider text-stone-400">
                Calendars · tap everyone each calendar belongs to
              </div>
              {googleData.sources.map((src) => (
                <div
                  key={src.id}
                  className={`p-2.5 rounded-xl border space-y-2 ${
                    src.enabled ? 'bg-stone-50 border-stone-200' : 'bg-white border-stone-200/70'
                  }`}
                >
                  <label className="flex items-center gap-2.5 min-w-0 min-h-[40px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={src.enabled}
                      onChange={(e) => updateSourceMutation.mutate({ id: src.id, enabled: e.target.checked })}
                      className="w-5 h-5 rounded shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className={`font-bold text-sm truncate ${src.enabled ? 'text-slate-800' : 'text-stone-400'}`}>
                        {src.name}
                        {!src.enabled && <span className="ml-2 text-[11px] font-semibold">(not shown)</span>}
                      </div>
                      <div className="text-[11px] text-stone-400 truncate">{src.accountEmail}</div>
                      {src.enabled && src.syncError && (
                        <div className="text-[11px] font-semibold text-rose-600 break-words select-text">
                          Sync error: <Linkify text={src.syncError} />
                        </div>
                      )}
                    </div>
                  </label>

                  <div className={`flex flex-wrap gap-1.5 ${src.enabled ? '' : 'opacity-50'}`}>
                    {members.map((m) => {
                      const selected = src.memberIds.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleSourceMember(src, m.id)}
                          className="h-10 min-h-[40px] min-w-[40px] px-3 rounded-full border text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
                          style={
                            selected
                              ? { background: m.colorBg, color: m.colorText, borderColor: m.colorAccent }
                              : { background: '#fff', color: '#78716c', borderColor: '#e7e5e4' }
                          }
                        >
                          {selected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span>{m.emoji}</span>}
                          {m.name}
                        </button>
                      );
                    })}
                    <span className="self-center w-px h-6 bg-stone-200 mx-1" aria-hidden />
                    {EVENT_CATEGORIES.map((cat) => {
                      const c = CATEGORY_STYLES[cat];
                      const selected = src.category === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          aria-pressed={selected}
                          title={`Show this calendar as ${c.label.toLowerCase()} (${c.icon} color)`}
                          onClick={() => updateSourceMutation.mutate({ id: src.id, category: selected ? null : cat })}
                          className="h-10 min-h-[40px] min-w-[40px] px-3 rounded-full border text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
                          style={
                            selected
                              ? { background: c.bg, color: c.text, borderColor: c.accent }
                              : { background: '#fff', color: '#78716c', borderColor: '#e7e5e4' }
                          }
                        >
                          <span aria-hidden>{c.icon}</span>
                          {c.label}
                        </button>
                      );
                    })}
                    {src.memberIds.length === 0 && !src.category && (
                      <span className="self-center text-[11px] text-stone-400 ml-1">
                        Nobody selected: shows for everyone
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 5b. Google Keep two-way list sync */}
        <KeepSyncSection members={members} />

        {/* 6. Family Profiles & Colors (Heading verbatim for E2E tests) */}
        <section className="bg-white rounded-3xl border border-stone-200 p-5 space-y-4 shadow-2xs">
          <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
            <Users className="w-5 h-5 text-rose-500" />
            Family Profiles & Colors
          </h3>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {members.map((m, index) => (
              <div
                key={m.id}
                style={{ backgroundColor: m.colorBg, color: m.colorText }}
                className="px-3.5 py-2.5 rounded-2xl flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-xl">{m.emoji}</span>
                  <span className="font-extrabold truncate">{m.name}</span>
                  <span className="text-xs uppercase font-bold opacity-70 shrink-0">
                    ({m.role})
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {/* Reorder Up */}
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveMember(index, 'up')}
                    className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-lg hover:bg-black/10 disabled:opacity-30 flex items-center justify-center"
                    title="Move up"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>

                  {/* Reorder Down */}
                  <button
                    type="button"
                    disabled={index === members.length - 1}
                    onClick={() => moveMember(index, 'down')}
                    className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-lg hover:bg-black/10 disabled:opacity-30 flex items-center justify-center"
                    title="Move down"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>

                  {/* Edit Member */}
                  <button
                    type="button"
                    onClick={() => openEditModal(m)}
                    className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-lg hover:bg-black/10 flex items-center justify-center"
                    title="Edit profile"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  {/* Delete Member */}
                  {members.length > 1 && (
                    <button
                      type="button"
                      onClick={() => deleteMemberMutation.mutate(m.id)}
                      className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-lg hover:bg-black/10 flex items-center justify-center"
                      title="Delete profile"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add New Member Form with flex-wrap on swatches */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newMemberName.trim()) addMemberMutation.mutate();
            }}
            className="pt-2 border-t border-stone-100 space-y-2.5"
          >
            <div className="flex gap-2">
              <EmojiPickerButton
                value={newMemberEmoji}
                onChange={setNewMemberEmoji}
                label="Avatar emoji for new person"
              />
              <input
                type="text"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Add person (e.g. Emma)..."
                className="flex-1 h-11 min-h-[40px] px-3.5 rounded-xl bg-stone-50 border border-stone-200 font-semibold text-sm"
              />
              <select
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value as MemberRole)}
                className="h-11 min-h-[40px] min-w-[40px] px-2.5 rounded-xl bg-stone-50 border border-stone-200 font-bold text-xs"
              >
                <option value="parent">Parent</option>
                <option value="child">Child</option>
                <option value="family">Shared</option>
              </select>
              <button
                type="submit"
                className="px-4 h-11 min-h-[40px] min-w-[40px] rounded-xl bg-slate-900 text-white font-bold text-sm flex items-center justify-center gap-1"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {SKYLIGHT_COLOR_PRESETS.map((p, idx) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setPresetIdx(idx)}
                  style={{ backgroundColor: p.colorBg, borderColor: p.colorAccent }}
                  className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-full border-2 ${
                    presetIdx === idx ? 'scale-115 ring-2 ring-slate-800' : 'opacity-75'
                  }`}
                  title={p.name}
                />
              ))}
            </div>
          </form>
        </section>

        {/* 7. Gemini AI Key & SQLite WAL Backups */}
        <section className="bg-white rounded-3xl border border-stone-200 p-5 space-y-4 shadow-2xs">
          <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-600" />
            AI Recipe Extraction & SQLite Backups
          </h3>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              Gemini API Key (Recipe Web Extraction & Discovery)
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder={
                  settings.geminiApiKeyConfigured
                    ? 'Gemini API Key Configured ✓ (enter new to replace)'
                    : 'Paste AIza... Gemini API Key'
                }
                className="flex-1 h-10 min-h-[40px] px-3 rounded-xl bg-stone-50 border border-stone-200 text-xs font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  updateSettingsMutation.mutate({ geminiApiKey: geminiKey });
                  setGeminiKey('');
                }}
                className="px-4 h-10 min-h-[40px] min-w-[40px] rounded-xl bg-slate-800 text-white text-xs font-bold"
              >
                Save Key
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-stone-100 flex items-center justify-between">
            <div className="text-xs text-stone-500">
              <div className="font-bold text-slate-700 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-emerald-600" />
                SQLite WAL Local Storage
              </div>
              <div>
                {settings.lastBackupAt
                  ? `Last snapshot: ${new Date(settings.lastBackupAt).toLocaleString()}`
                  : 'Automatic daily rolling backups enabled'}
              </div>
            </div>
            <button
              type="button"
              onClick={triggerBackup}
              className="px-4 h-10 min-h-[40px] min-w-[40px] rounded-xl bg-stone-100 hover:bg-stone-200 text-slate-800 font-bold text-xs"
            >
              Backup Now
            </button>
          </div>
        </section>
      </div>

      {/* Edit Member Profile Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-3xl border border-stone-200 p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-sky-600" />
                Edit Profile: {editingMember.name}
              </h4>
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl hover:bg-stone-100 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
                  Name & Avatar
                </label>
                <div className="flex gap-2">
                  <EmojiPickerButton
                    value={editEmoji}
                    onChange={setEditEmoji}
                    label={`Avatar emoji for ${editName || 'member'}`}
                  />
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Member Name"
                    className="flex-1 h-11 min-h-[40px] px-3.5 rounded-xl bg-stone-50 border border-stone-200 font-semibold text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
                  Household Role
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as MemberRole)}
                  className="w-full h-11 min-h-[40px] min-w-[40px] px-3 rounded-xl bg-stone-50 border border-stone-200 font-bold text-sm"
                >
                  <option value="parent">Parent</option>
                  <option value="child">Child (Chore Star Tracking)</option>
                  <option value="family">Shared Household</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1.5">
                  Color Accent Theme
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {SKYLIGHT_COLOR_PRESETS.map((p, idx) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => setEditPresetIdx(idx)}
                      style={{ backgroundColor: p.colorBg, borderColor: p.colorAccent }}
                      className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-full border-2 ${
                        editPresetIdx === idx ? 'scale-115 ring-2 ring-slate-800' : 'opacity-75'
                      }`}
                      title={p.name}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="h-10 min-h-[40px] min-w-[40px] px-4 rounded-xl bg-stone-100 hover:bg-stone-200 font-bold text-xs text-stone-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEditMember}
                className="h-10 min-h-[40px] min-w-[40px] px-5 rounded-xl bg-slate-900 hover:bg-slate-800 font-bold text-xs text-white"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
