import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar as CalendarIcon } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { formatTimeShort } from '../lib/dates.js';
import { WeatherWidget } from '../components/WeatherWidget.js';
import type { AppSettings, CalendarEvent, PhotoItem } from '../../shared/types.js';

interface ScreensaverProps {
  active: boolean;
  onWake: () => void;
  settings: AppSettings;
}

export function isWithinNightHours(
  now: Date,
  startHHMM?: string | null,
  endHHMM?: string | null
): boolean {
  const start = (startHHMM || '22:00').trim() || '22:00';
  const end = (endHHMM || '06:30').trim() || '06:30';
  const [sh, sm] = start.split(':').map((v) => Number(v) || 0);
  const [eh, em] = end.split(':').map((v) => Number(v) || 0);
  const curMins = now.getHours() * 60 + now.getMinutes();
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;

  if (startMins <= endMins) {
    return curMins >= startMins && curMins < endMins;
  }
  return curMins >= startMins || curMins < endMins;
}

export const FALLBACK_PHOTOS: PhotoItem[] = [
  {
    id: 'fallback_landscape_1',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%231e293b"/><stop offset="100%" stop-color="%230f172a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(%23bg)"/><circle cx="960" cy="400" r="160" fill="%2338bdf8" opacity="0.15"/><path d="M0 1080 L600 680 L900 850 L1400 500 L1920 1080 Z" fill="%23334155" opacity="0.6"/><path d="M400 1080 L900 720 L1200 860 L1600 650 L1920 1080 Z" fill="%231e293b" opacity="0.8"/><text x="960" y="580" fill="%2394a3b8" font-family="system-ui, sans-serif" font-size="32" text-anchor="middle" font-weight="600">Lucarne Ambient Display</text></svg>',
    orientation: 'landscape',
    caption: 'Lucarne Ambient Sanctuary',
    source: 'starter',
    albumId: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'fallback_portrait_1',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="%230f172a"/><stop offset="100%" stop-color="%231e1b4b"/></linearGradient></defs><rect width="100%" height="100%" fill="url(%23g1)"/><circle cx="540" cy="700" r="220" fill="%23818cf8" opacity="0.18"/><path d="M0 1920 L300 1400 L600 1600 L1080 1200 L1080 1920 Z" fill="%23312e81" opacity="0.5"/><text x="540" y="1000" fill="%23a5b4fc" font-family="system-ui, sans-serif" font-size="28" text-anchor="middle">Family Moments</text></svg>',
    orientation: 'portrait',
    caption: 'Family Moments',
    source: 'starter',
    albumId: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'fallback_portrait_2',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><defs><linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="%23111827"/><stop offset="100%" stop-color="%23064e3b"/></linearGradient></defs><rect width="100%" height="100%" fill="url(%23g2)"/><circle cx="540" cy="700" r="220" fill="%2334d399" opacity="0.18"/><path d="M0 1920 L400 1350 L750 1580 L1080 1300 L1080 1920 Z" fill="%23065f46" opacity="0.5"/><text x="540" y="1000" fill="%236ee7b7" font-family="system-ui, sans-serif" font-size="28" text-anchor="middle">Nature Sanctuary</text></svg>',
    orientation: 'portrait',
    caption: 'Nature Sanctuary',
    source: 'starter',
    albumId: null,
    createdAt: new Date().toISOString(),
  },
];

/** Deterministic Fisher-Yates shuffle for a given seed (stable across re-renders). */
export function shufflePhotos(photos: PhotoItem[], seed: number): PhotoItem[] {
  const out = [...photos];
  let state = Math.floor(seed * 2 ** 31) || 1;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pairPhotos(photos: PhotoItem[]): Array<PhotoItem[]> {
  if (!photos || photos.length === 0) return [];
  const portraits = photos.filter((p) => p.orientation === 'portrait');
  const landscapes = photos.filter((p) => p.orientation !== 'portrait');

  const pairedPortraits: Array<PhotoItem[]> = [];
  if (portraits.length === 1) {
    // Lone portrait
    pairedPortraits.push([portraits[0]]);
  } else if (portraits.length > 1) {
    for (let i = 0; i < portraits.length; i += 2) {
      if (i + 1 < portraits.length) {
        pairedPortraits.push([portraits[i], portraits[i + 1]]);
      } else {
        // Odd wrap-around: pair last portrait with first portrait so no portrait is cropped on 16:9
        pairedPortraits.push([portraits[i], portraits[0]]);
      }
    }
  }

  // Interleave landscapes and paired portraits
  const slides: Array<PhotoItem[]> = [];
  const maxLen = Math.max(landscapes.length, pairedPortraits.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < landscapes.length) slides.push([landscapes[i]]);
    if (i < pairedPortraits.length) slides.push(pairedPortraits[i]);
  }
  return slides;
}

export const ScreensaverOverlay: React.FC<ScreensaverProps> = ({
  active,
  onWake,
  settings,
}) => {
  const [now, setNow] = useState(() => new Date());
  const [currentLayer, setCurrentLayer] = useState<'A' | 'B'>('A');
  const [slideA, setSlideA] = useState<PhotoItem[]>([]);
  const [slideB, setSlideB] = useState<PhotoItem[]>([]);
  const [slideIdx, setSlideIdx] = useState(0);

  const { data: rawPhotos = [] } = useQuery({
    queryKey: ['photos'],
    queryFn: () => apiFetch<PhotoItem[]>('/api/photos'),
    enabled: active,
  });

  const photos = rawPhotos.length > 0 ? rawPhotos : FALLBACK_PHOTOS;

  const { data: upcomingEvents = [] } = useQuery({
    queryKey: ['events', 'screensaver-upcoming'],
    queryFn: () => {
      const s = new Date().toISOString();
      const e = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
      return apiFetch<CalendarEvent[]>(
        `/api/events?start=${encodeURIComponent(s)}&end=${encodeURIComponent(e)}`
      );
    },
    enabled: active,
  });

  // Fresh random order each time the screensaver starts, so large albums don't repeat the same sequence.
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.random());
  useEffect(() => {
    if (active) setShuffleSeed(Math.random());
  }, [active]);
  const slides = useMemo(() => pairPhotos(shufflePhotos(photos, shuffleSeed)), [photos, shuffleSeed]);

  // Synchronize slide layers when slides change
  useEffect(() => {
    if (!active) return;
    if (slides.length > 0) {
      const initial = slides[0];
      setSlideA(initial);
      setSlideB(initial);
      setCurrentLayer('A');
      setSlideIdx(0);
    }
  }, [active, slides]);

  // Clock tick & dual-layer crossfade timer
  useEffect(() => {
    if (!active) return;
    const clockTimer = setInterval(() => setNow(new Date()), 15_000);

    const slideTimer = setInterval(() => {
      if (slides.length <= 1) return;
      setSlideIdx((prev) => {
        const nextIdx = (prev + 1) % slides.length;
        const nextSlide = slides[nextIdx];
        setCurrentLayer((layer) => {
          if (layer === 'A') {
            setSlideB(nextSlide);
            return 'B';
          } else {
            setSlideA(nextSlide);
            return 'A';
          }
        });
        return nextIdx;
      });
    }, 12_000);

    return () => {
      clearInterval(clockTimer);
      clearInterval(slideTimer);
    };
  }, [active, slides]);

  // Blur any focused element upon activation to prevent inadvertent keystroke/spacebar clicks
  useEffect(() => {
    if (active && document.activeElement && 'blur' in document.activeElement && typeof (document.activeElement as HTMLElement).blur === 'function') {
      (document.activeElement as HTMLElement).blur();
    }
  }, [active]);

  // Keyboard wake listener
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      onWake();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, onWake]);

  if (!active) return null;

  const isNight =
    Boolean(settings.nightModeEnabled) &&
    isWithinNightHours(now, settings.nightModeStart, settings.nightModeEnd);

  const nightBrightness =
    (settings as { nightModeBrightness?: number }).nightModeBrightness ?? 25;
  const photoLayerOpacity = isNight ? nightBrightness / 100 : 0.95;

  const nextEvent = upcomingEvents.find(
    (ev) => !ev.allDay && new Date(ev.endIso).getTime() > Date.now()
  );

  const renderSlideContent = (slide: PhotoItem[]) => {
    if (!slide || slide.length === 0) return null;

    if (slide.length === 1) {
      const photo = slide[0];
      if (photo.orientation === 'portrait') {
        // Lone portrait: Centered with ambient blurred background canvas
        return (
          <div className="relative w-full h-full overflow-hidden flex items-center justify-center bg-stone-950">
            <img
              src={photo.url}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover blur-3xl scale-110 opacity-35"
              onError={(e) => {
                e.currentTarget.src = FALLBACK_PHOTOS[0].url;
              }}
            />
            <div className="relative z-10 max-w-full max-h-full flex items-center justify-center p-6">
              <img
                src={photo.url}
                alt={photo.caption}
                className="max-h-[88vh] max-w-full object-contain rounded-2xl shadow-2xl border border-white/10"
                onError={(e) => {
                  e.currentTarget.src = FALLBACK_PHOTOS[1].url;
                }}
              />
            </div>
            {photo.caption && (
              <div className="absolute bottom-6 left-12 right-12 text-center text-sm font-medium text-white/75 drop-shadow">
                {photo.caption}
              </div>
            )}
          </div>
        );
      }
      // Landscape photo: Full 16:9 widescreen cover
      return (
        <div className="relative w-full h-full overflow-hidden">
          <img
            src={photo.url}
            alt={photo.caption}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.src = FALLBACK_PHOTOS[0].url;
            }}
          />
          {photo.caption && (
            <div className="absolute top-8 right-10 px-4 py-2 rounded-xl bg-black/40 backdrop-blur-md text-xs font-semibold text-white/80">
              {photo.caption}
            </div>
          )}
        </div>
      );
    }

    // 2-column paired portraits
    return (
      <div className="w-full h-full grid grid-cols-2 gap-3 bg-stone-950 p-3">
        {slide.map((p, idx) => (
          <div key={`${p.id}-${idx}`} className="relative w-full h-full overflow-hidden rounded-2xl">
            <img
              src={p.url}
              alt={p.caption}
              className="w-full h-full object-cover rounded-2xl"
              onError={(e) => {
                e.currentTarget.src = idx === 0 ? FALLBACK_PHOTOS[1].url : FALLBACK_PHOTOS[2].url;
              }}
            />
            {p.caption && (
              <div className="absolute bottom-4 left-4 right-4 px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-xs font-medium text-white/80 truncate">
                {p.caption}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      onPointerDown={onWake}
      className="fixed inset-0 z-[200] bg-black text-white cursor-pointer select-none overflow-hidden touch-manipulation"
    >
      {/* Photo Layers with 1000ms Crossfade Transition (suppressed in minimal night-clock mode) */}
      {!(isNight && settings.nightModeBehavior === 'clock') && (
        <div
          style={{ opacity: photoLayerOpacity }}
          className="absolute inset-0 transition-opacity duration-1000"
        >
          {/* Layer A */}
          <div
            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
              currentLayer === 'A' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
            }`}
          >
            {renderSlideContent(slideA)}
          </div>

          {/* Layer B */}
          <div
            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
              currentLayer === 'B' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
            }`}
          >
            {renderSlideContent(slideB)}
          </div>

          {/* Ambient vignette gradient */}
          <div className="absolute inset-0 z-20 pointer-events-none bg-gradient-to-t from-black/75 via-transparent to-black/25" />
        </div>
      )}

      {/* Night Mode OLED Amber Clock (Active during night clock mode) */}
      {isNight && settings.nightModeBehavior === 'clock' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black">
          <div className="text-amber-500/40 font-mono text-8xl md:text-9xl font-extrabold tracking-widest drop-shadow-sm">
            {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div className="text-amber-500/25 font-mono text-xl md:text-2xl mt-4">
            {now.toLocaleDateString([], {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </div>
        </div>
      ) : (
        /* Daytime Bottom Appliance Clock, Weather & Next Up Overlay */
        <div className="absolute bottom-10 left-12 right-12 z-30 flex items-end justify-between gap-6">
          <div className="space-y-1 drop-shadow-lg">
            <div className="text-7xl font-extrabold tracking-tight leading-none">
              {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
            <div className="text-2xl font-semibold text-white/85 flex items-center gap-4 pt-1">
              <span>
                {now.toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
              <WeatherWidget
                lat={settings.weatherLat}
                lon={settings.weatherLon}
                unit={settings.weatherUnit}
                compact
              />
            </div>
          </div>

          {nextEvent && (
            <div className="bg-black/45 backdrop-blur-md border border-white/15 rounded-2xl px-5 py-3.5 max-w-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5" />
                Up Next
              </div>
              <div className="font-bold text-lg truncate mt-0.5">{nextEvent.title}</div>
              <div className="text-sm text-white/75">
                {formatTimeShort(nextEvent.startIso)} – {formatTimeShort(nextEvent.endIso)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
