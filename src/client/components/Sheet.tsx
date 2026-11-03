import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/** Standard Lucarne modal: dimmed backdrop, rounded card, title row with a big close button, Esc closes. */
export const Sheet: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  maxWidth?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Optional element id for tests / aria */
  testId?: string;
}> = ({ title, subtitle, onClose, maxWidth = 'max-w-xl', children, footer, testId }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-start md:items-center justify-center p-3 md:p-4 overflow-y-auto"
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        className={`bg-white rounded-3xl shadow-2xl border border-stone-200 w-full ${maxWidth} my-4 flex flex-col max-h-[calc(100dvh-2rem)]`}
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-xl font-extrabold text-slate-800 flex items-center gap-2">{title}</h3>
            {subtitle && <div className="text-sm text-stone-500 mt-0.5">{subtitle}</div>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-600 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto min-h-0 flex-1 space-y-4">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-stone-100 shrink-0">{footer}</div>}
      </div>
    </div>
  );
};

/** Pill-style member picker used across the new sheets. */
export const MemberChips: React.FC<{
  members: Array<{ id: string; name: string; emoji: string; colorBg: string; colorText: string; colorAccent: string }>;
  value: string[];
  onChange: (ids: string[]) => void;
  single?: boolean;
  allowNone?: boolean;
  noneLabel?: string;
}> = ({ members, value, onChange, single, allowNone, noneLabel = 'Anyone' }) => (
  <div className="flex flex-wrap gap-2">
    {allowNone && (
      <button
        type="button"
        onClick={() => onChange([])}
        className={`h-10 min-h-[40px] px-3.5 rounded-2xl border-2 font-bold text-sm transition active:scale-95 ${
          value.length === 0 ? 'bg-slate-800 border-slate-800 text-white' : 'bg-stone-50 border-stone-200 text-stone-500'
        }`}
      >
        {noneLabel}
      </button>
    )}
    {members.map((m) => {
      const on = value.includes(m.id);
      return (
        <button
          key={m.id}
          type="button"
          aria-pressed={on}
          onClick={() => {
            if (single) onChange(on && allowNone ? [] : [m.id]);
            else onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id]);
          }}
          style={on ? { backgroundColor: m.colorBg, color: m.colorText, borderColor: m.colorAccent } : undefined}
          className={`h-10 min-h-[40px] px-3.5 rounded-2xl border-2 font-bold text-sm flex items-center gap-2 transition active:scale-95 ${
            on ? 'shadow-2xs' : 'bg-stone-50 border-stone-200 text-stone-500'
          }`}
        >
          <span>{m.emoji}</span>
          <span>{m.name}</span>
        </button>
      );
    })}
  </div>
);

export const fieldLabel = 'block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1.5';
export const inputClass = 'w-full h-12 px-4 rounded-xl bg-stone-50 border border-stone-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500';
export const primaryBtn = 'h-12 px-5 rounded-2xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold shadow-sm active:scale-95 transition';
export const secondaryBtn = 'h-12 px-5 rounded-2xl bg-stone-100 hover:bg-stone-200 font-bold text-slate-700 active:scale-95 transition';
