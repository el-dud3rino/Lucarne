import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  type LucideIcon,
} from 'lucide-react';

export interface DayForecast {
  code: number;
  hi: number;
  lo: number;
  precipChance: number | null;
}

export const FORECAST_DAYS = 10;

/** Maps a WMO weather code (Open-Meteo) to an icon, color and short label. */
export function weatherVisual(code: number): { Icon: LucideIcon; color: string; label: string } {
  if (code >= 95) return { Icon: CloudLightning, color: 'text-purple-500', label: 'Thunderstorms' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { Icon: CloudSnow, color: 'text-sky-400', label: 'Snow' };
  if (code >= 61 && code <= 82) return { Icon: CloudRain, color: 'text-sky-500', label: 'Rain' };
  if (code >= 51 && code <= 57) return { Icon: CloudDrizzle, color: 'text-sky-400', label: 'Drizzle' };
  if (code === 45 || code === 48) return { Icon: CloudFog, color: 'text-slate-400', label: 'Fog' };
  if (code === 3) return { Icon: Cloud, color: 'text-slate-400', label: 'Cloudy' };
  if (code === 1 || code === 2) return { Icon: CloudSun, color: 'text-amber-500', label: 'Partly cloudy' };
  return { Icon: Sun, color: 'text-amber-500', label: 'Sunny' };
}

/** 10-day daily forecast keyed by local YYYY-MM-DD (Open-Meteo, no API key). */
export function useDailyForecast(lat: number, lon: number, unit: 'F' | 'C') {
  return useQuery({
    queryKey: ['weather-daily', lat, lon, unit],
    queryFn: async () => {
      const tempUnit = unit === 'F' ? 'fahrenheit' : 'celsius';
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
        `&temperature_unit=${tempUnit}&timezone=auto&forecast_days=${FORECAST_DAYS}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Forecast unavailable');
      const data = (await res.json()) as {
        daily?: {
          time: string[];
          weather_code: number[];
          temperature_2m_max: number[];
          temperature_2m_min: number[];
          precipitation_probability_max?: Array<number | null>;
        };
      };
      const map = new Map<string, DayForecast>();
      const d = data.daily;
      if (!d) return map;
      d.time.forEach((dateStr, i) => {
        const hi = d.temperature_2m_max[i];
        const lo = d.temperature_2m_min[i];
        if (hi == null || lo == null) return;
        map.set(dateStr, {
          code: d.weather_code[i] ?? 0,
          hi: Math.round(hi),
          lo: Math.round(lo),
          precipChance: d.precipitation_probability_max?.[i] ?? null,
        });
      });
      return map;
    },
    staleTime: 30 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    retry: 2,
  });
}

/** Compact per-day weather badge for calendar day headers and month cells. */
export const DayWeather: React.FC<{ forecast?: DayForecast; variant?: 'full' | 'compact' }> = ({
  forecast,
  variant = 'full',
}) => {
  if (!forecast) return null;
  const { Icon, color, label } = weatherVisual(forecast.code);
  const showRain = forecast.precipChance !== null && forecast.precipChance >= 30;
  const title = `${label}, high ${forecast.hi}°, low ${forecast.lo}°${
    forecast.precipChance !== null ? `, ${forecast.precipChance}% chance of precipitation` : ''
  }`;

  if (variant === 'compact') {
    return (
      <span className="flex items-center gap-0.5 text-[11px] font-bold text-slate-500" title={title}>
        <Icon className={`w-3.5 h-3.5 ${color}`} aria-hidden />
        {forecast.hi}°
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0" title={title} aria-label={title}>
      <Icon className={`w-6 h-6 shrink-0 ${color}`} aria-hidden />
      <div className="leading-tight">
        <div className="text-sm font-extrabold text-slate-700 whitespace-nowrap">
          {forecast.hi}°<span className="text-stone-400 font-semibold">/{forecast.lo}°</span>
        </div>
        {showRain && (
          <div className="text-[11px] font-bold text-sky-600 whitespace-nowrap">{forecast.precipChance}% rain</div>
        )}
      </div>
    </div>
  );
};
