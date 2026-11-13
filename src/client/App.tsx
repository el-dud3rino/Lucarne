import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  CheckSquare,
  House,
  Image as ImageIcon,
  ListChecks,
  Palette,
  Settings as SettingsIcon,
  UtensilsCrossed,
} from 'lucide-react';
import { apiFetch, useRealtimeSync } from './lib/api.js';
import { eventLook } from './lib/eventColors.js';
import { WeatherWidget } from './components/WeatherWidget.js';
import { OnScreenKeyboard } from './components/OnScreenKeyboard.js';
import { LeaveBanner, SyncStatusChip } from './components/TodayBar.js';
import { CalendarView } from './views/CalendarView.js';
import { HomeView } from './views/HomeView.js';
import { ChoresView } from './views/ChoresView.js';
import { ListsView } from './views/ListsView.js';
import { MealsView } from './views/MealsView.js';
import { DrawView } from './views/DrawView.js';
import { ScreensaverOverlay } from './views/ScreensaverOverlay.js';
import { SettingsView } from './views/SettingsView.js';
import { GROCERY_CATEGORIES, type AppSettings, type FamilyMember } from '../shared/types.js';

type NavTab = 'home' | 'calendar' | 'chores' | 'lists' | 'meals' | 'draw' | 'settings';

const FALLBACK_SETTINGS: AppSettings = {
  familyName: 'Our Family',
  kioskKeyboardEnabled: true,
  screensaverIdleMinutes: 10,
  nightModeEnabled: true,
  nightModeStart: '22:00',
  nightModeEnd: '06:30',
  nightModeBehavior: 'dim',
  weatherLat: 39.8283,
  weatherLon: -98.5795,
  weatherLocationName: 'Local Weather',
  weatherUnit: 'F',
  showDinnerOnCalendar: true,
  showBirthdays: true,
  showHolidays: true,
  showBriefOnScreensaver: true,
  groceryAisleOrder: [...GROCERY_CATEGORIES],
  defaultGroceryListId: 'list-groceries',
  googleClientId: '',
  googleClientSecretConfigured: false,
  geminiApiKeyConfigured: false,
  lastBackupAt: null,
};

export const App: React.FC = () => {
  const { connected } = useRealtimeSync();

  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (t === 'home' || t === 'calendar' || t === 'settings' || t === 'chores' || t === 'lists' || t === 'meals' || t === 'draw') return t;
    // The wall opens on Home ("today at a glance"); phones open on the calendar.
    return window.matchMedia?.('(min-width: 768px)').matches ? 'home' : 'calendar';
  });

  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [screensaverActive, setScreensaverActive] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: members = [] } = useQuery({
    queryKey: ['family'],
    queryFn: () => apiFetch<FamilyMember[]>('/api/family'),
  });

  const { data: settings = FALLBACK_SETTINGS } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<AppSettings>('/api/settings'),
  });

  // Live header clock
  useEffect(() => {
    const t = setInterval(() => setClockNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  // Idle timeout -> Photo Frame Screensaver
  useEffect(() => {
    const mins = settings.screensaverIdleMinutes;
    if (!mins || mins <= 0) return;

    const resetIdle = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setScreensaverActive(true);
      }, mins * 60_000);
    };

    resetIdle();
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const ev of events) window.addEventListener(ev, resetIdle, { passive: true });
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      for (const ev of events) window.removeEventListener(ev, resetIdle);
    };
  }, [settings.screensaverIdleMinutes]);

  const toggleMemberFilter = (id: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const navItems: Array<{ key: NavTab; label: string; Icon: React.ElementType }> = [
    { key: 'home', label: 'Home', Icon: House },
    { key: 'calendar', label: 'Calendar', Icon: Calendar },
    { key: 'chores', label: 'Chores', Icon: CheckSquare },
    { key: 'lists', label: 'Lists', Icon: ListChecks },
    { key: 'meals', label: 'Meals', Icon: UtensilsCrossed },
    { key: 'draw', label: 'Draw', Icon: Palette },
    { key: 'settings', label: 'Settings', Icon: SettingsIcon },
  ];


  /** Tap-to-filter family member chips (shared by the wall header and the phone row). */
  const renderMemberFilter = (className: string) => (
    <div className={`flex items-center gap-1.5 overflow-x-auto py-1 ${className}`}>
      {selectedMemberIds.length > 0 && (
        <button
          type="button"
          onClick={() => setSelectedMemberIds([])}
          className="h-10 min-h-[40px] px-3.5 rounded-full bg-stone-200 text-xs font-extrabold text-slate-700 shrink-0 flex items-center justify-center"
        >
          All
        </button>
      )}
      {members.map((m) => {
        const isSelected =
          selectedMemberIds.length === 0 || selectedMemberIds.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => toggleMemberFilter(m.id)}
            style={{
              background: m.role === 'family' ? eventLook({ memberIds: [m.id], category: null }, members).background : m.colorBg,
              color: m.colorText,
              borderColor:
                selectedMemberIds.includes(m.id) ? m.colorAccent : 'transparent',
            }}
            className={`h-10 min-h-[40px] min-w-[40px] px-3 rounded-full border-2 flex items-center gap-1.5 font-extrabold text-sm shrink-0 transition active:scale-95 ${
              isSelected ? 'opacity-100 shadow-2xs' : 'opacity-35 grayscale'
            }`}
          >
            <span>{m.emoji}</span>
            <span className="member-name hidden lg:inline">{m.name}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="h-dvh w-screen overflow-hidden flex flex-col md:flex-row bg-[#FAF8F5] text-slate-800">
      {/* Skylight-Inspired Left Navigation Rail (1080p Landscape Desktop/Kiosk) */}
      <aside className="hidden md:flex flex-col items-center justify-between w-[88px] shrink-0 bg-white border-r border-stone-200/90 py-5 select-none">
        <div className="flex flex-col items-center gap-2.5 w-full px-2">
          {/* Brand Crest */}
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white font-black text-xl flex items-center justify-center shadow-sm mb-2">
            L
          </div>

          {navItems.map(({ key, label, Icon }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`w-full py-3 rounded-2xl flex flex-col items-center gap-1 transition active:scale-95 ${
                  active
                    ? 'bg-sky-50 text-sky-700 font-extrabold shadow-2xs'
                    : 'text-stone-400 hover:text-slate-700 hover:bg-stone-50 font-semibold'
                }`}
              >
                <Icon className={`w-6 h-6 ${active ? 'stroke-[2.5]' : 'stroke-[2]'}`} />
                <span className="text-[11px] leading-none">{label}</span>
              </button>
            );
          })}
        </div>

        {/* Sleep / Photo Frame Trigger */}
        <button
          type="button"
          onClick={() => setScreensaverActive(true)}
          className="w-14 h-14 rounded-2xl text-stone-400 hover:text-amber-600 hover:bg-amber-50 flex flex-col items-center justify-center gap-1 transition active:scale-95"
          title="Start Photo Screensaver"
        >
          <ImageIcon className="w-6 h-6" />
          <span className="text-[10px] font-bold">Photos</span>
        </button>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top Skylight Header Bar */}
        <header className="h-14 md:h-[72px] shrink-0 px-4 md:px-6 border-b border-stone-200/80 bg-[#FAF8F5] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-slate-900 truncate">
              {settings.familyName}
            </h1>
            <span
              title={connected ? 'Live sync active' : 'Working offline locally'}
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                connected ? 'bg-emerald-500' : 'bg-amber-400'
              }`}
            />
            <SyncStatusChip connected={connected} />
          </div>

          {/* Tap-to-Filter Family Member Avatars (wall/tablet: in the header) */}
          {(activeTab === 'calendar' || activeTab === 'chores') && renderMemberFilter('hidden md:flex')}

          {/* Right Clock & Weather Pill */}
          <div className="flex items-center gap-3 shrink-0">
            <WeatherWidget
              lat={settings.weatherLat}
              lon={settings.weatherLon}
              unit={settings.weatherUnit}
            />
            <div className="hidden sm:block text-right">
              <div className="text-lg font-extrabold text-slate-800 leading-none">
                {clockNow.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </div>
              <div className="text-[11px] font-bold text-stone-400">
                {clockNow.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
            </div>
          </div>
        </header>

        {/* Phones: family filter on its own row so the household name isn't squeezed */}
        {(activeTab === 'calendar' || activeTab === 'chores') && (
          <div className="md:hidden shrink-0 px-4 pt-2 border-b border-stone-200/60 bg-[#FAF8F5]">
            {renderMemberFilter('pb-2 [&_.member-name]:inline')}
          </div>
        )}

        {/* "Leave in 10 min" alerts for events with a drive time (every tab) */}
        <LeaveBanner members={members} />

        {/* Active View Canvas */}
        <main className="flex-1 min-h-0 p-3.5 md:p-5 overflow-hidden">
          {activeTab === 'home' && <HomeView members={members} settings={settings} onOpenTab={setActiveTab} />}
          {activeTab === 'calendar' && (
            <CalendarView
              members={members}
              selectedMemberIds={selectedMemberIds}
              settings={settings}
              onOpenMealTab={() => setActiveTab('meals')}
            />
          )}
          {activeTab === 'chores' && (
            <ChoresView members={members} selectedMemberIds={selectedMemberIds} />
          )}
          {activeTab === 'lists' && <ListsView />}
          {activeTab === 'meals' && <MealsView settings={settings} />}
          {activeTab === 'draw' && <DrawView members={members} />}
          {activeTab === 'settings' && (
            <SettingsView settings={settings} members={members} />
          )}
        </main>

        {/* Mobile Companion PWA Bottom Tab Bar (< 768px phones at the grocery store!) */}
        <nav className="md:hidden min-h-16 shrink-0 bg-white border-t border-stone-200 grid grid-cols-7 px-1 pb-[env(safe-area-inset-bottom,0px)]">
          {navItems.map(({ key, label, Icon }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
                className={`flex flex-col items-center justify-center gap-0.5 ${
                  active ? 'text-sky-600 font-extrabold' : 'text-stone-400 font-semibold'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px]">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Kiosk-Smart Built-In On-Screen Touch Keyboard */}
      <OnScreenKeyboard enabled={settings.kioskKeyboardEnabled} />

      {/* 1080p Idle Photo Frame & Night Dimmer */}
      <ScreensaverOverlay
        active={screensaverActive}
        onWake={() => setScreensaverActive(false)}
        settings={settings}
      />
    </div>
  );
};
