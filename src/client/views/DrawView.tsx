import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Trash2, Undo2, X } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { drawSegment, TOOL_COLORS, TOOL_ORDER, ToolIcon, type DrawTool } from '../components/DrawTools.js';
import type { Artwork, FamilyMember } from '../../shared/types.js';

/** The canvas is always 1920×1080, so drawings fill the wall slideshow edge to edge. */
const CANVAS_W = 1920;
const CANVAS_H = 1080;
/** Untouched this long → the drawing saves itself and goes back to "Who's drawing?" */
export const DRAW_IDLE_SAVE_MS = 60_000;
const UNDO_LEVELS = 5;

interface DrawSession {
  member: FamilyMember | null;
  artwork: Artwork | null;
}

export function useArtworks() {
  return useQuery({ queryKey: ['art'], queryFn: () => apiFetch<Artwork[]>('/api/art') });
}

/** Kids first, then grown-ups; the shared "Family" member can't hold a crayon. */
function artists(members: FamilyMember[]): FamilyMember[] {
  const people = members.filter((m) => m.role !== 'family');
  return [...people.filter((m) => m.role === 'child'), ...people.filter((m) => m.role !== 'child')];
}

export const DrawView: React.FC<{ members: FamilyMember[] }> = ({ members }) => {
  const queryClient = useQueryClient();
  const { data: artworks = [] } = useArtworks();
  const [session, setSession] = useState<DrawSession | null>(null);
  const [managing, setManaging] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/art/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ['art'] });
    },
  });

  const people = artists(members);
  const memberOf = (a: Artwork) => members.find((m) => m.id === a.memberId) ?? null;

  return (
    <div className="h-full flex flex-col gap-5 overflow-y-auto" data-testid="draw-view">
      <section className="bg-white rounded-3xl border border-stone-200 p-5 md:p-7">
        <h2 className="text-2xl md:text-4xl font-black text-slate-900 text-center">🎨 Who's drawing?</h2>
        <div className="mt-5 flex flex-wrap justify-center gap-4 md:gap-7">
          {people.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSession({ member: m, artwork: null })}
              data-testid={`draw-artist-${m.id}`}
              className="flex flex-col items-center gap-2 p-2 rounded-3xl transition active:scale-95"
            >
              <span
                style={{ backgroundColor: m.colorAccent }}
                className={`${m.role === 'child' ? 'w-24 h-24 md:w-36 md:h-36 text-5xl md:text-7xl' : 'w-20 h-20 md:w-28 md:h-28 text-4xl md:text-6xl'} rounded-full flex items-center justify-center shadow-md`}
              >
                {m.emoji}
              </span>
              <span className="text-lg md:text-2xl font-black" style={{ color: m.colorText }}>
                {m.name}
              </span>
            </button>
          ))}
          {people.length === 0 && (
            <p className="text-stone-500 font-semibold">Add family members in Settings to start drawing.</p>
          )}
        </div>
      </section>

      {artworks.length > 0 && (
        <section className="bg-white rounded-3xl border border-stone-200 p-5 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl md:text-2xl font-black text-slate-900">🖼️ Keep drawing</h3>
            <button
              type="button"
              onClick={() => {
                setManaging((v) => !v);
                setConfirmDeleteId(null);
              }}
              className="px-3 py-2 rounded-xl text-sm font-bold text-stone-500 hover:bg-stone-100"
            >
              {managing ? 'Done' : 'Manage pictures'}
            </button>
          </div>
          <p className="text-sm text-stone-500 font-semibold">
            Tap a picture to add more to it. Saved pictures show up in the photo slideshow.
          </p>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {artworks.map((a) => {
              const m = memberOf(a);
              const confirming = confirmDeleteId === a.id;
              return (
                <div key={a.id} className="relative">
                  <button
                    type="button"
                    disabled={managing}
                    onClick={() => setSession({ member: m, artwork: a })}
                    className="block w-full aspect-video rounded-2xl overflow-hidden border-4 bg-white shadow-sm transition active:scale-95"
                    style={{ borderColor: m?.colorAccent ?? '#E7E5E4' }}
                    data-testid="draw-artwork"
                  >
                    <img src={a.url} alt={m ? `${m.name}'s drawing` : 'Drawing'} loading="lazy" decoding="async" className="w-full h-full object-contain" />
                  </button>
                  {m && (
                    <span
                      style={{ backgroundColor: m.colorAccent }}
                      className="absolute -bottom-2 -left-2 w-10 h-10 rounded-full text-2xl flex items-center justify-center shadow pointer-events-none"
                    >
                      {m.emoji}
                    </span>
                  )}
                  {managing && !confirming && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(a.id)}
                      aria-label="Delete picture"
                      className="absolute top-2 right-2 w-10 h-10 rounded-full bg-rose-600 text-white flex items-center justify-center shadow"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                  {confirming && (
                    <div className="absolute inset-0 rounded-2xl bg-black/60 flex flex-col items-center justify-center gap-2 text-white">
                      <span className="font-bold">Delete this picture?</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => remove.mutate(a.id)} className="px-4 py-2 rounded-xl bg-rose-600 font-bold">
                          Delete
                        </button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 rounded-xl bg-white/20 font-bold">
                          Keep
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {session && (
        <DrawCanvas
          key={session.artwork?.id ?? `new-${session.member?.id}`}
          member={session.member}
          artwork={session.artwork}
          onClose={() => setSession(null)}
        />
      )}
    </div>
  );
};

type Phase = 'drawing' | 'confirmTrash' | 'saving' | 'saved';

/**
 * Full-screen drawing page. Built for a 3-year-old: pictures instead of words, giant buttons.
 * - ✓ saves the picture (it joins the slideshow) and goes back.
 * - Left alone for 60 s, it saves itself the same way; it can be reopened later to keep drawing.
 * - The left button exits; once something is drawn it becomes a trash can that asks first.
 */
export const DrawCanvas: React.FC<{
  member: FamilyMember | null;
  artwork: Artwork | null;
  onClose: () => void;
}> = ({ member, artwork, onClose }) => {
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<DrawTool>('crayon');
  const [colors, setColors] = useState<Record<Exclude<DrawTool, 'eraser'>, string>>({
    crayon: TOOL_COLORS.crayon[0],
    marker: TOOL_COLORS.marker[6],
    paint: TOOL_COLORS.paint[2],
  });
  const [phase, setPhase] = useState<Phase>('drawing');
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!artwork);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const undoStack = useRef<ImageData[]>([]);
  const lastActivity = useRef(Date.now());
  const dirtyRef = useRef(false);
  const phaseRef = useRef<Phase>('drawing');
  phaseRef.current = phase;
  dirtyRef.current = dirty;

  const color = tool === 'eraser' ? '#FFFFFF' : colors[tool];
  const ctx = () => canvasRef.current?.getContext('2d') ?? null;

  // White paper, then the saved picture when resuming.
  useEffect(() => {
    const c = ctx();
    if (!c) return;
    c.fillStyle = '#FFFFFF';
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);
    if (!artwork) return;
    const img = new Image();
    img.onload = () => {
      c.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
      setLoaded(true);
    };
    img.onerror = () => setLoaded(true);
    img.src = artwork.url;
  }, [artwork]);

  // Fit the 16:9 paper into whatever space the screen gives it.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const scale = Math.min(el.clientWidth / CANVAS_W, el.clientHeight / CANVAS_H);
      setDisplaySize({ w: Math.floor(CANVAS_W * scale), h: Math.floor(CANVAS_H * scale) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    setPhase('saving');
    setSaveError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not read the drawing');
      const res = await fetch(artwork ? `/api/art/${artwork.id}` : `/api/art?memberId=${encodeURIComponent(member?.id ?? '')}`, {
        method: artwork ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: blob,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['art'] });
      return true;
    } catch (err) {
      setSaveError(`Couldn't save the picture (${(err as Error).message}). Try ✓ again.`);
      setPhase('drawing');
      lastActivity.current = Date.now();
      return false;
    }
  }, [artwork, member, queryClient]);

  const finish = useCallback(async () => {
    if (!dirtyRef.current) {
      onClose();
      return;
    }
    if (await save()) {
      setPhase('saved');
      setTimeout(onClose, 1600);
    }
  }, [onClose, save]);

  // Left alone for a minute: keep the picture (if there is one) and go back to "Who's drawing?"
  useEffect(() => {
    const t = setInterval(() => {
      if (phaseRef.current === 'saving' || phaseRef.current === 'saved') return;
      if (Date.now() - lastActivity.current >= DRAW_IDLE_SAVE_MS) void finish();
    }, 1000);
    return () => clearInterval(t);
  }, [finish]);

  const touch = () => {
    lastActivity.current = Date.now();
  };

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * CANVAS_W) / rect.width,
      y: ((e.clientY - rect.top) * CANVAS_H) / rect.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    touch();
    const c = ctx();
    if (!c || !loaded || phase !== 'drawing') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 0) {
      undoStack.current.push(c.getImageData(0, 0, CANVAS_W, CANVAS_H));
      if (undoStack.current.length > UNDO_LEVELS) undoStack.current.shift();
      setCanUndo(true);
    }
    const p = toCanvas(e);
    pointers.current.set(e.pointerId, p);
    drawSegment(c, tool, color, p.x, p.y, p.x, p.y);
    setDirty(true);
    setSaveError(null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const last = pointers.current.get(e.pointerId);
    const c = ctx();
    if (!last || !c) return;
    touch();
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    let prev = last;
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const p = toCanvas(ev);
      drawSegment(c, tool, color, prev.x, prev.y, p.x, p.y);
      prev = p;
    }
    pointers.current.set(e.pointerId, prev);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    touch();
  };

  const undo = () => {
    touch();
    const snap = undoStack.current.pop();
    if (snap) ctx()?.putImageData(snap, 0, 0);
    setCanUndo(undoStack.current.length > 0);
  };

  const pickTool = (t: DrawTool) => {
    touch();
    setTool(t);
  };

  const pickColor = (c: string) => {
    touch();
    if (tool !== 'eraser') setColors((prev) => ({ ...prev, [tool]: c }));
  };

  const accent = member?.colorAccent ?? '#F59E0B';

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col select-none"
      style={{ backgroundColor: member?.colorBg ?? '#FEF3C7' }}
      onPointerDownCapture={touch}
      data-testid="draw-canvas"
    >
      {/* Top: exit / trash on the left, who's drawing in the middle, undo + done on the right */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-3 md:px-5 pt-3 md:pt-4">
        <button
          type="button"
          onClick={() => (dirty ? setPhase('confirmTrash') : onClose())}
          aria-label={dirty ? 'Throw away' : 'Exit'}
          data-testid="draw-exit"
          className={`w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center shadow-md active:scale-95 transition ${
            dirty ? 'bg-rose-500 text-white' : 'bg-white text-slate-600'
          }`}
        >
          {dirty ? <Trash2 className="w-8 h-8 md:w-10 md:h-10" /> : <X className="w-9 h-9 md:w-11 md:h-11" strokeWidth={3} />}
        </button>

        {member && (
          <div className="flex items-center gap-2 min-w-0">
            <span style={{ backgroundColor: accent }} className="w-12 h-12 md:w-14 md:h-14 rounded-full text-3xl md:text-4xl flex items-center justify-center shadow shrink-0">
              {member.emoji}
            </span>
            <span className="text-xl md:text-3xl font-black truncate" style={{ color: member.colorText }}>
              {member.name}
            </span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            aria-label="Undo"
            className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-white text-slate-700 flex items-center justify-center shadow-md active:scale-95 transition disabled:opacity-30"
          >
            <Undo2 className="w-7 h-7 md:w-8 md:h-8" strokeWidth={3} />
          </button>
          <button
            type="button"
            onClick={() => void finish()}
            aria-label="Done"
            data-testid="draw-done"
            className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md active:scale-95 transition"
          >
            <Check className="w-10 h-10 md:w-12 md:h-12" strokeWidth={4} />
          </button>
        </div>
      </div>

      {saveError && (
        <div className="mx-4 mt-2 px-4 py-2 rounded-xl bg-rose-100 text-rose-800 font-bold text-center">{saveError}</div>
      )}

      {/* The paper */}
      <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center p-3 md:p-4">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          data-ready={loaded ? 'true' : 'false'}
          style={{ width: displaySize.w, height: displaySize.h, touchAction: 'none' }}
          className="bg-white rounded-2xl shadow-xl"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={onPointerUp}
        />
      </div>

      {/* Bottom: the tools, then the colors for that tool (swipe sideways for more) */}
      <div className="shrink-0 flex flex-col md:flex-row items-stretch gap-2 md:gap-4 px-3 md:px-5 pb-3 md:pb-4">
        <div className="flex justify-center gap-2 bg-white/70 rounded-3xl p-2 shrink-0">
          {TOOL_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => pickTool(t)}
              aria-label={t}
              aria-pressed={tool === t}
              data-testid={`draw-tool-${t}`}
              className={`w-16 h-20 md:w-20 md:h-28 rounded-2xl flex items-end justify-center transition active:scale-95 ${
                tool === t ? 'bg-white shadow-md ring-4' : 'opacity-60'
              }`}
              style={tool === t ? { ['--tw-ring-color' as string]: accent } : undefined}
            >
              <ToolIcon tool={t} color={t === 'eraser' ? '#fff' : colors[t]} className="h-16 md:h-24 w-auto" />
            </button>
          ))}
        </div>

        {tool !== 'eraser' && (
          <div className="flex-1 min-w-0 flex items-end gap-1 md:gap-2 overflow-x-auto touch-pan-x bg-white/70 rounded-3xl px-3 pt-4 pb-1 overscroll-contain">
            {TOOL_COLORS[tool].map((c) => {
              const selected = colors[tool] === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => pickColor(c)}
                  aria-label={`color ${c}`}
                  aria-pressed={selected}
                  className={`shrink-0 transition-transform ${selected ? '-translate-y-3 scale-110' : 'active:scale-95'}`}
                >
                  <ToolIcon tool={tool} color={c} className="h-16 md:h-24 w-auto drop-shadow" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Throw it away? Big pictures, no reading needed. */}
      {phase === 'confirmTrash' && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center gap-8 md:gap-16 p-6" data-testid="draw-trash-confirm">
          <button
            type="button"
            onClick={() => {
              touch();
              setPhase('drawing');
            }}
            aria-label="Keep drawing"
            className="w-36 h-36 md:w-48 md:h-48 rounded-full bg-white flex flex-col items-center justify-center shadow-2xl active:scale-95 transition"
          >
            <span className="text-6xl md:text-8xl">🖍️</span>
            <span className="text-base md:text-xl font-black text-slate-700">Keep</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Throw away"
            data-testid="draw-trash-yes"
            className="w-36 h-36 md:w-48 md:h-48 rounded-full bg-rose-500 text-white flex flex-col items-center justify-center shadow-2xl active:scale-95 transition"
          >
            <Trash2 className="w-16 h-16 md:w-24 md:h-24" />
            <span className="text-base md:text-xl font-black">Throw away</span>
          </button>
        </div>
      )}

      {phase === 'saving' && (
        <div className="absolute inset-0 bg-white/40 flex items-center justify-center">
          <span className="text-6xl animate-bounce">🖼️</span>
        </div>
      )}

      {phase === 'saved' && (
        <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-3" data-testid="draw-saved">
          <span className="text-[120px] md:text-[180px] leading-none animate-bounce">🌟</span>
          <span className="px-6 py-3 rounded-full bg-white text-3xl md:text-5xl font-black text-amber-600 shadow-xl">Beautiful!</span>
        </div>
      )}
    </div>
  );
};
