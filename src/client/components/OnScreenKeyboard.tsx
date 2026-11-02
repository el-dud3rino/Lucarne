import React, { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Delete, ChevronDown, ArrowBigUp } from 'lucide-react';

interface OnScreenKeyboardProps {
  enabled: boolean;
}

const ALPHA_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const NUM_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
  ['.', ',', '?', '!', "'", '#', '%', '+'],
];

const QUICK_CHIPS = ['Milk', 'Eggs', 'Bread', 'Apples', 'Chicken', 'Practice', 'Appointment'];

function setNativeInputValue(el: HTMLInputElement | HTMLTextAreaElement, nextValue: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) {
    descriptor.set.call(el, nextValue);
  } else {
    el.value = nextValue;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function findScrollParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

export const OnScreenKeyboard: React.FC<OnScreenKeyboardProps> = ({ enabled }) => {
  const [target, setTarget] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [shifted, setShifted] = useState(true);
  const [numMode, setNumMode] = useState(false);
  const [previewVal, setPreviewVal] = useState('');
  const keyboardRef = useRef<HTMLDivElement | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const handledByPointer = useRef(false);
  const adjustedContainerRef = useRef<{ el: HTMLElement; origPaddingBottom: string } | null>(null);

  const stopRepeat = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  };

  const restorePadding = () => {
    if (adjustedContainerRef.current) {
      adjustedContainerRef.current.el.style.paddingBottom = adjustedContainerRef.current.origPaddingBottom;
      adjustedContainerRef.current = null;
    }
  };

  // Adjust container padding and auto-scroll focused input into view
  useEffect(() => {
    if (!target) {
      restorePadding();
      return;
    }

    const container = findScrollParent(target);
    if (container) {
      if (!adjustedContainerRef.current || adjustedContainerRef.current.el !== container) {
        restorePadding();
        adjustedContainerRef.current = {
          el: container,
          origPaddingBottom: container.style.paddingBottom,
        };
      }
      const kbHeight = keyboardRef.current?.getBoundingClientRect().height || 330;
      container.style.paddingBottom = `${kbHeight + 24}px`;
    }

    const scrollTimer = setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const verifyTimer = setTimeout(() => {
        const kbRect = keyboardRef.current?.getBoundingClientRect();
        const inputRect = target.getBoundingClientRect();
        if (kbRect && kbRect.top > 0 && inputRect.bottom > kbRect.top - 12) {
          const delta = inputRect.bottom - (kbRect.top - 20);
          if (container) {
            container.scrollTop += delta;
          } else {
            window.scrollBy({ top: delta, behavior: 'smooth' });
          }
        }
      }, 140);

      return () => clearTimeout(verifyTimer);
    }, 60);

    return () => {
      clearTimeout(scrollTimer);
    };
  }, [target]);

  // Window resize handler for mobile suppression
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        stopRepeat();
        restorePadding();
        setTarget(null);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Cleanup timers and container padding on unmount
  useEffect(() => {
    return () => {
      stopRepeat();
      restorePadding();
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      stopRepeat();
      restorePadding();
      setTarget(null);
      return;
    }

    const handleFocusIn = (e: FocusEvent) => {
      // Suppress on mobile companion (<768px) so native iOS/Android keyboard handles input cleanly
      if (window.innerWidth < 768) return;

      const el = e.target;
      if (el instanceof HTMLInputElement) {
        const nonTextTypes = new Set([
          'checkbox',
          'radio',
          'file',
          'color',
          'range',
          'date',
          'time',
          'datetime-local',
          'button',
          'submit',
        ]);
        if (nonTextTypes.has(el.type) || el.readOnly || el.disabled) return;
        setTarget(el);
        setPreviewVal(el.value);
        setNumMode(el.type === 'number');
        setShifted(el.value.length === 0);
      } else if (el instanceof HTMLTextAreaElement) {
        if (el.readOnly || el.disabled) return;
        setTarget(el);
        setPreviewVal(el.value);
        setNumMode(false);
        setShifted(el.value.length === 0);
      }
    };

    const handleInput = (e: Event) => {
      if (e.target === target && target) {
        setPreviewVal(target.value);
      }
    };

    const handleFocusOut = () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLInputElement) && !(active instanceof HTMLTextAreaElement)) {
          stopRepeat();
          restorePadding();
          setTarget(null);
        }
      }, 120);
    };

    // Submitting a form (Search button, Enter, or the keyboard's Done key) means typing is finished:
    // close the keyboard so it doesn't cover the results that are about to appear.
    const handleSubmit = () => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
      stopRepeat();
      restorePadding();
      setTarget(null);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('input', handleInput);
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('submit', handleSubmit, true);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('input', handleInput);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('submit', handleSubmit, true);
    };
  }, [enabled, target]);

  if (!enabled || !target) return null;

  const insertText = (txt: string) => {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const next = target.value.slice(0, start) + txt + target.value.slice(end);
    setNativeInputValue(target, next);
    setPreviewVal(next);
    const cursor = start + txt.length;
    try {
      target.setSelectionRange(cursor, cursor);
    } catch {
      // number/email inputs ignore setSelectionRange
    }
    if (shifted && txt.length === 1 && /[A-Z]/.test(txt)) {
      setShifted(false);
    }
  };

  const handleBackspace = () => {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    let next = target.value;
    let cursor = start;
    if (start !== end) {
      next = target.value.slice(0, start) + target.value.slice(end);
    } else if (start > 0) {
      next = target.value.slice(0, start - 1) + target.value.slice(end);
      cursor = start - 1;
    } else if (target.value.length > 0) {
      next = target.value.slice(0, -1);
      cursor = next.length;
    }
    setNativeInputValue(target, next);
    setPreviewVal(next);
    try {
      target.setSelectionRange(cursor, cursor);
    } catch {
      // ignore
    }
    if (next.length === 0) setShifted(true);
  };

  const handleEnter = () => {
    if (target instanceof HTMLTextAreaElement) {
      insertText('\n');
      return;
    }
    const form = target.closest('form');
    if (form) {
      form.requestSubmit();
    } else {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      );
      target.blur();
      stopRepeat();
      restorePadding();
      setTarget(null);
    }
  };

  const rows = numMode ? NUM_ROWS : ALPHA_ROWS;

  return (
    <div
      ref={keyboardRef}
      onPointerDown={(e) => e.preventDefault()}
      className="hidden md:block fixed inset-x-0 bottom-0 z-[100] bg-[#EFECE6]/98 backdrop-blur-md border-t border-stone-300 shadow-2xl px-6 pt-2.5 pb-4 select-none"
    >
      {/* Top Preview & Quick-Tap Bar */}
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 flex-1 min-w-0 bg-white rounded-xl px-4 py-2 border border-stone-200 shadow-xs">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-400 shrink-0">
            {target.placeholder || 'Typing'}
          </span>
          <span className="text-base font-medium text-slate-800 truncate">
            {previewVal || <span className="text-stone-300">Start typing...</span>}
          </span>
          {previewVal && (
            <button
              type="button"
              onClick={() => {
                setNativeInputValue(target, '');
                setPreviewVal('');
                setShifted(true);
              }}
              className="ml-auto text-xs font-semibold text-stone-400 hover:text-stone-700 px-3 h-10 min-h-[40px] rounded-md bg-stone-100 flex items-center justify-center"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => insertText(previewVal ? ` ${chip}` : chip)}
              className="h-10 min-h-[40px] px-3.5 py-2 rounded-xl bg-white hover:bg-amber-50 active:scale-95 border border-stone-200 text-sm font-medium text-slate-700 transition flex items-center justify-center"
            >
              {chip}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            stopRepeat();
            restorePadding();
            target.blur();
            setTarget(null);
          }}
          className="h-10 min-h-[40px] px-3.5 py-2 rounded-xl bg-stone-200 hover:bg-stone-300 active:scale-95 text-slate-700 font-semibold text-sm flex items-center gap-1.5"
        >
          <ChevronDown className="w-4 h-4" />
          Hide
        </button>
      </div>

      {/* Keys Grid */}
      <div className="max-w-5xl mx-auto flex flex-col gap-2">
        {rows.map((row, rIdx) => (
          <div key={rIdx} className="flex justify-center gap-2">
            {rIdx === 2 && !numMode && (
              <button
                type="button"
                onClick={() => setShifted((s) => !s)}
                className={`w-20 h-14 rounded-xl font-semibold flex items-center justify-center shadow-xs border transition active:scale-95 ${
                  shifted
                    ? 'bg-sky-600 text-white border-sky-700'
                    : 'bg-stone-200 text-slate-700 border-stone-300'
                }`}
              >
                <ArrowBigUp className="w-6 h-6" />
              </button>
            )}

            {row.map((ch) => {
              const display = !numMode && shifted ? ch.toUpperCase() : ch;
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => insertText(display)}
                  className="flex-1 max-w-[84px] h-14 rounded-xl bg-white hover:bg-stone-50 active:bg-sky-100 active:scale-95 border border-stone-200/90 shadow-xs text-xl font-semibold text-slate-800 transition"
                >
                  {display}
                </button>
              );
            })}

            {rIdx === 2 && (
              <button
                type="button"
                onClick={() => {
                  if (handledByPointer.current) {
                    handledByPointer.current = false;
                    return;
                  }
                  handleBackspace();
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  stopRepeat();
                  handledByPointer.current = true;
                  handleBackspace();
                  holdTimer.current = setTimeout(() => {
                    repeatTimer.current = setInterval(handleBackspace, 95);
                  }, 500);
                }}
                onPointerUp={stopRepeat}
                onPointerLeave={stopRepeat}
                onPointerCancel={stopRepeat}
                className="w-24 h-14 rounded-xl bg-stone-200 hover:bg-stone-300 active:bg-rose-100 active:scale-95 border border-stone-300 flex items-center justify-center text-slate-700 shadow-xs transition"
              >
                <Delete className="w-6 h-6" />
              </button>
            )}
          </div>
        ))}

        {/* Bottom Space & Action Row */}
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => setNumMode((n) => !n)}
            className="w-28 h-14 rounded-xl bg-stone-200 hover:bg-stone-300 active:scale-95 border border-stone-300 font-bold text-slate-700 shadow-xs"
          >
            {numMode ? 'ABC' : '123 / #'}
          </button>
          <button
            type="button"
            onClick={() => insertText(', ')}
            className="w-16 h-14 rounded-xl bg-white active:scale-95 border border-stone-200 font-bold text-xl text-slate-700 shadow-xs"
          >
            ,
          </button>
          <button
            type="button"
            onClick={() => insertText(' ')}
            className="flex-1 max-w-xl h-14 rounded-xl bg-white hover:bg-stone-50 active:bg-sky-50 active:scale-[0.99] border border-stone-200 font-medium text-stone-400 shadow-xs text-base"
          >
            space
          </button>
          <button
            type="button"
            onClick={() => insertText('.')}
            className="w-16 h-14 rounded-xl bg-white active:scale-95 border border-stone-200 font-bold text-xl text-slate-700 shadow-xs"
          >
            .
          </button>
          <button
            type="button"
            onClick={handleEnter}
            className="w-36 h-14 rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-semibold flex items-center justify-center gap-2 shadow-sm"
          >
            <CornerDownLeft className="w-5 h-5" />
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
