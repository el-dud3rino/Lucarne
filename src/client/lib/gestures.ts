import { useEffect, useRef, useState, type RefObject } from 'react';

/** Phones get their own layouts (under Tailwind's md breakpoint, 768px). */
export function useIsPhone(): boolean {
  const query = '(max-width: 767px)';
  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setIsPhone(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isPhone;
}

/** Whether a touch started inside something that scrolls sideways (let it scroll instead). */
function insideHorizontalScroller(target: EventTarget | null, root: HTMLElement): boolean {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== root) {
    if (el.dataset.noSwipe !== undefined) return true;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'CANVAS') return true;
    if (el.scrollWidth > el.clientWidth + 2) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Swipe left/right to page through days. The content follows the finger a little, then springs
 * back; a swipe of ~60px (or a quick flick) calls onPrev/onNext. Vertical scrolling is untouched.
 * Returns a key that changes after each swipe, for a slide-in animation.
 */
export function useSwipePaging(
  ref: RefObject<HTMLElement | null>,
  { onPrev, onNext, enabled = true }: { onPrev: () => void; onNext: () => void; enabled?: boolean }
): { direction: 'left' | 'right' | null; key: number } {
  const handlers = useRef({ onPrev, onNext });
  handlers.current = { onPrev, onNext };
  const [anim, setAnim] = useState<{ direction: 'left' | 'right' | null; key: number }>({ direction: null, key: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;
    let horizontal: boolean | null = null;
    let suppressClick = false;

    const reset = () => {
      el.style.transition = 'transform 180ms ease-out';
      el.style.transform = '';
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || insideHorizontalScroller(e.target, el)) {
        tracking = false;
        return;
      }
      tracking = true;
      horizontal = null;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startT = performance.now();
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (horizontal === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        horizontal = Math.abs(dx) > Math.abs(dy) * 1.3;
      }
      if (horizontal) {
        if (e.cancelable) e.preventDefault();
        el.style.transition = 'none';
        el.style.transform = `translateX(${dx * 0.35}px)`;
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      if (!horizontal) return;
      const dx = (e.changedTouches[0]?.clientX ?? startX) - startX;
      const fast = Math.abs(dx) > 30 && performance.now() - startT < 250;
      reset();
      if (Math.abs(dx) >= 60 || fast) {
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 350);
        if (dx < 0) {
          handlers.current.onNext();
          setAnim((a) => ({ direction: 'left', key: a.key + 1 }));
        } else {
          handlers.current.onPrev();
          setAnim((a) => ({ direction: 'right', key: a.key + 1 }));
        }
      }
    };

    // A swipe that ends over an event must not also open it.
    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick) {
        e.stopPropagation();
        e.preventDefault();
        suppressClick = false;
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', reset);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', reset);
      el.removeEventListener('click', onClickCapture, true);
      el.style.transform = '';
    };
  }, [ref, enabled]);

  return anim;
}
