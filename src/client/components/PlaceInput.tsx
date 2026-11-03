import React, { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

interface Suggestion {
  placeId: string;
  main: string;
  secondary: string;
}

/** Works over plain-http LAN too, where crypto.randomUUID isn't available. */
const newSessionToken = () =>
  Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');

/**
 * A text box with Google Maps place search: type "bright smiles" and pick the business, and the full
 * address goes in the box. Without a Maps key (`enabled` false) it's an ordinary text box, and typing
 * anything by hand always works.
 */
export const PlaceInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  enabled: boolean;
  placeholder?: string;
  className?: string;
  testId?: string;
}> = ({ value, onChange, enabled, placeholder, className, testId }) => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(newSessionToken());
  const typed = useRef(false); // only search after the user types, not for a pre-filled value
  const reqId = useRef(0);

  useEffect(() => {
    if (!enabled || !typed.current || value.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const list = await apiFetch<Suggestion[]>(
          `/api/maps/autocomplete?q=${encodeURIComponent(value)}&session=${session.current}`
        );
        if (id !== reqId.current) return;
        setSuggestions(list);
        setError(null);
        setOpen(true);
      } catch (err) {
        if (id === reqId.current) setError((err as Error).message);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [value, enabled]);

  const pick = async (s: Suggestion) => {
    setOpen(false);
    setSuggestions([]);
    typed.current = false;
    onChange([s.main, s.secondary].filter(Boolean).join(', ')); // instant feedback, refined below
    try {
      const r = await apiFetch<{ location: string }>(`/api/maps/place/${encodeURIComponent(s.placeId)}?session=${session.current}`);
      onChange(r.location);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      session.current = newSessionToken(); // a pick ends Google's billing session
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        data-testid={testId}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white rounded-xl border border-stone-200 shadow-lg overflow-hidden" data-testid="place-suggestions">
          {suggestions.slice(0, 5).map((s) => (
            <button
              key={s.placeId}
              type="button"
              onPointerDown={(e) => e.preventDefault()} // keep focus so the list doesn't vanish before the tap lands
              onClick={() => void pick(s)}
              className="w-full min-h-[48px] px-3 py-2 flex items-start gap-2 text-left hover:bg-sky-50 active:bg-sky-100"
            >
              <MapPin className="w-4 h-4 mt-0.5 text-sky-600 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-800 truncate">{s.main}</span>
                {s.secondary && <span className="block text-xs text-stone-500 truncate">{s.secondary}</span>}
              </span>
            </button>
          ))}
          <div className="px-3 py-1 text-[10px] text-stone-400 text-right">Powered by Google</div>
        </div>
      )}
      {error && <div className="mt-1 text-xs font-semibold text-rose-600">{error}</div>}
    </div>
  );
};
