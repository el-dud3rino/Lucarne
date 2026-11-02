import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cloud, CloudRain, CloudSnow, Sun, CloudLightning } from 'lucide-react';

interface WeatherProps {
  lat: number;
  lon: number;
  unit: 'F' | 'C';
  compact?: boolean;
}

export const WeatherWidget: React.FC<WeatherProps> = ({ lat, lon, unit, compact }) => {
  const { data } = useQuery({
    queryKey: ['weather', lat, lon, unit],
    queryFn: async () => {
      const tempUnit = unit === 'F' ? 'fahrenheit' : 'celsius';
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=${tempUnit}&timezone=auto&forecast_days=1`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Weather unavailable');
      return res.json() as Promise<{
        current?: { temperature_2m: number; weather_code: number };
        daily?: { temperature_2m_max: number[]; temperature_2m_min: number[] };
      }>;
    },
    staleTime: 25 * 60 * 1000,
    retry: 1,
  });

  if (!data?.current) return null;

  const code = data.current.weather_code;
  const temp = Math.round(data.current.temperature_2m);
  const hi = data.daily?.temperature_2m_max?.[0]
    ? Math.round(data.daily.temperature_2m_max[0])
    : null;
  const lo = data.daily?.temperature_2m_min?.[0]
    ? Math.round(data.daily.temperature_2m_min[0])
    : null;

  let Icon = Sun;
  let iconColor = 'text-amber-500';
  if (code >= 95) {
    Icon = CloudLightning;
    iconColor = 'text-purple-500';
  } else if (code >= 71 && code <= 77) {
    Icon = CloudSnow;
    iconColor = 'text-sky-400';
  } else if (code >= 51 && code <= 82) {
    Icon = CloudRain;
    iconColor = 'text-sky-500';
  } else if (code >= 1 && code <= 48) {
    Icon = Cloud;
    iconColor = 'text-slate-400';
  }

  return (
    <div
      className={`flex items-center gap-2 ${
        compact
          ? 'text-white/95'
          : 'bg-white border border-stone-200/90 px-3.5 py-2 rounded-2xl shadow-2xs'
      }`}
    >
      <Icon className={`w-5 h-5 shrink-0 ${compact ? 'text-amber-300' : iconColor}`} />
      <span className="font-bold text-base leading-none">
        {temp}°{unit}
      </span>
      {!compact && hi !== null && lo !== null && (
        <span className="text-xs font-medium text-stone-400 hidden xl:inline">
          H:{hi}° L:{lo}°
        </span>
      )}
    </div>
  );
};
