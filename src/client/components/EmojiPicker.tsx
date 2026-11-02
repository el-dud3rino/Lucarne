import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Touch-first emoji picker: a button showing the current emoji that opens a tappable grid.
 * Used instead of a text input so the kiosk / phone keyboard doesn't pop up just to pick an avatar.
 * Single-codepoint emojis are preferred so they render on Linux kiosks (Noto Color Emoji).
 */

const CATEGORIES: Array<{ label: string; icon: string; emojis: string[] }> = [
  {
    label: 'Faces',
    icon: '🙂',
    emojis: [
      '🙂', '😀', '😃', '😄', '😁', '😆', '😊', '😇', '🥰', '😍', '🤩', '😎', '🤓', '🧐', '😜', '🤪',
      '😋', '🤗', '🤠', '🥳', '😺', '😸', '😻', '🤖', '👻', '👽', '🎃', '😴', '🤔', '🫡', '🥸', '😌',
    ],
  },
  {
    label: 'People',
    icon: '👧',
    emojis: [
      '👶', '👧', '🧒', '👦', '👩', '🧑', '👨', '👱', '👵', '🧓', '👴', '👸', '🤴', '🦸', '🦹', '🧙',
      '🧚', '🧜', '🧝', '🥷', '👮', '👷', '💂', '🕵', '🧑‍🚀', '🧑‍🍳', '🧑‍🎨', '🧑‍🚒', '🧑‍🏫', '🧑‍💻', '👯', '💃',
    ],
  },
  {
    label: 'Animals',
    icon: '🦄',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
      '🐧', '🐦', '🐤', '🦆', '🦉', '🦄', '🐴', '🐝', '🦋', '🐞', '🐢', '🐍', '🦖', '🦕', '🐙', '🦈',
      '🐬', '🐳', '🦭', '🦩', '🦜', '🦔', '🐿', '🦦',
    ],
  },
  {
    label: 'Nature',
    icon: '🌸',
    emojis: [
      '🌸', '🌼', '🌻', '🌺', '🌷', '🌹', '🌵', '🌴', '🌲', '🍀', '🍁', '🍄', '🌈', '☀️', '🌙', '⭐',
      '🌟', '✨', '⚡', '🔥', '❄️', '☃️', '🌊', '💧', '🌍', '🪐', '☁️', '🌪',
    ],
  },
  {
    label: 'Food',
    icon: '🍕',
    emojis: [
      '🍎', '🍓', '🍒', '🍉', '🍌', '🍍', '🥑', '🥕', '🌽', '🍕', '🍔', '🌮', '🍟', '🍿', '🧁', '🍩',
      '🍪', '🎂', '🍦', '🍭', '🍫', '🥞', '🧇', '☕', '🧃', '🥤',
    ],
  },
  {
    label: 'Activities',
    icon: '⚽',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🏓', '🏒', '🥍', '⛳', '🏹', '🎣', '🥊', '🛹',
      '⛸', '🎿', '🏂', '🏊', '🚴', '🧗', '🤸', '🩰', '🎨', '🎭', '🎤', '🎧', '🎸', '🎹', '🥁', '🎮',
      '🧩', '♟', '🎯', '🎳', '🏆', '🥇', '🎪', '🎬',
    ],
  },
  {
    label: 'Travel',
    icon: '🚀',
    emojis: [
      '🚗', '🚕', '🚙', '🏎', '🚓', '🚑', '🚒', '🚜', '🚲', '🛴', '🏍', '🚂', '✈️', '🚁', '🚀', '🛸',
      '⛵', '🚤', '🛳', '⚓', '🏠', '🏡', '🏰', '🏕', '🏖', '🏝', '🗽', '🎡', '🎢', '⛺',
    ],
  },
  {
    label: 'Objects',
    icon: '🎁',
    emojis: [
      '🎁', '🎈', '🎉', '🎀', '🧸', '🪁', '📚', '✏️', '🖍', '🎒', '👑', '💎', '🔮', '🪄', '🧲', '🔭',
      '💡', '🔑', '🛠', '🧰', '📷', '📱', '💻', '⌚', '🕶', '👓', '🧢', '👟', '🩱', '☂️',
    ],
  },
  {
    label: 'Symbols',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💖', '💝', '💕', '☮️', '☯️', '♻️', '✅',
      '💯', '🔆', '🌀', '🎵', '🏳️‍🌈', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤',
    ],
  },
];

interface EmojiPickerButtonProps {
  value: string;
  onChange: (emoji: string) => void;
  /** Accessible label, e.g. "Avatar for Emma" */
  label?: string;
  className?: string;
}

export const EmojiPickerButton: React.FC<EmojiPickerButtonProps> = ({
  value,
  onChange,
  label = 'Choose emoji',
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [categoryIdx, setCategoryIdx] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const category = CATEGORIES[categoryIdx];

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => {
          // Blur any focused text field so the on-screen / native keyboard closes.
          (document.activeElement as HTMLElement | null)?.blur?.();
          setOpen(true);
        }}
        className={`w-12 h-11 min-h-[40px] min-w-[40px] rounded-xl bg-stone-50 border border-stone-200 hover:bg-stone-100 text-2xl leading-none flex items-center justify-center active:scale-95 transition ${className}`}
      >
        {value || '🙂'}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] bg-slate-900/40 flex items-end md:items-center justify-center p-0 md:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full md:max-w-xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col max-h-[80vh]"
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div className="font-extrabold text-slate-800">Pick an emoji</div>
              <button
                type="button"
                aria-label="Close emoji picker"
                onClick={() => setOpen(false)}
                className="w-10 h-10 min-h-[40px] min-w-[40px] rounded-xl hover:bg-stone-100 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-1 px-3 pb-2 overflow-x-auto" role="tablist">
              {CATEGORIES.map((c, i) => (
                <button
                  key={c.label}
                  type="button"
                  role="tab"
                  aria-selected={i === categoryIdx}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setCategoryIdx(i)}
                  className={`h-11 min-h-[40px] min-w-[44px] px-2 rounded-xl text-xl shrink-0 ${
                    i === categoryIdx ? 'bg-sky-100 ring-2 ring-sky-300' : 'hover:bg-stone-100'
                  }`}
                >
                  {c.icon}
                </button>
              ))}
            </div>

            <div className="px-3 pb-1 text-xs font-bold uppercase tracking-wider text-stone-400">{category.label}</div>
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-1 px-3 pb-4 overflow-y-auto">
              {category.emojis.map((em) => (
                <button
                  key={em}
                  type="button"
                  aria-label={`Use ${em}`}
                  onClick={() => {
                    onChange(em);
                    setOpen(false);
                  }}
                  className={`h-12 min-h-[40px] min-w-[40px] rounded-xl text-2xl flex items-center justify-center hover:bg-stone-100 active:scale-90 transition ${
                    em === value ? 'bg-sky-50 ring-2 ring-sky-300' : ''
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
