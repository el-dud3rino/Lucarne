import React from 'react';

/** The drawing tools on the Draw tab, each with its own box of colors. */
export type DrawTool = 'crayon' | 'marker' | 'paint' | 'eraser';

export const TOOL_COLORS: Record<Exclude<DrawTool, 'eraser'>, string[]> = {
  crayon: [
    '#E53935', '#FB8C00', '#FDD835', '#C0CA33', '#43A047', '#26A69A', '#81D4FA', '#1E88E5',
    '#3949AB', '#8E24AA', '#EC407A', '#FFAB91', '#795548', '#9E9E9E', '#212121',
  ],
  marker: [
    '#FF1744', '#FF6D00', '#FFD600', '#76FF03', '#00C853', '#1DE9B6', '#00B0FF', '#2962FF',
    '#AA00FF', '#F50057', '#FF80AB', '#6D4C41', '#000000',
  ],
  paint: [
    '#D32F2F', '#F57C00', '#FBC02D', '#AED581', '#388E3C', '#4DD0E1', '#1976D2', '#7B1FA2',
    '#F06292', '#8D6E63', '#FFFFFF', '#212121',
  ],
};

export const TOOL_ORDER: DrawTool[] = ['crayon', 'marker', 'paint', 'eraser'];

const darker = (hex: string, amt = 0.35): string => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amt));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
};

/** A standing crayon in `color`. */
export const CrayonIcon: React.FC<{ color: string; className?: string }> = ({ color, className }) => (
  <svg viewBox="0 0 40 110" className={className} aria-hidden="true">
    <path d="M12 26 L20 2 L28 26 Z" fill={color} />
    <rect x="9" y="24" width="22" height="84" rx="3" fill={color} />
    <rect x="9" y="38" width="22" height="52" fill={darker(color, 0.2)} />
    <path d="M9 46 h22 M9 82 h22" stroke="rgba(255,255,255,0.55)" strokeWidth="3" />
    <rect x="9" y="24" width="22" height="84" rx="3" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
  </svg>
);

/** A marker with a colored cap and tip. */
export const MarkerIcon: React.FC<{ color: string; className?: string }> = ({ color, className }) => (
  <svg viewBox="0 0 40 110" className={className} aria-hidden="true">
    <path d="M15 14 L20 2 L25 14 Z" fill={color} />
    <rect x="11" y="12" width="18" height="10" rx="2" fill="#E7E5E4" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
    <rect x="7" y="22" width="26" height="86" rx="7" fill="#FAFAF9" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
    <rect x="7" y="22" width="26" height="30" rx="7" fill={color} />
    <circle cx="20" cy="80" r="7" fill={color} />
  </svg>
);

/** A paint jar full of `color` with a brush in it. */
export const PaintIcon: React.FC<{ color: string; className?: string }> = ({ color, className }) => (
  <svg viewBox="0 0 60 110" className={className} aria-hidden="true">
    <rect x="34" y="4" width="6" height="56" rx="3" fill="#B45309" transform="rotate(14 37 32)" />
    <path d="M38 52 q4 10 -1 18 q-6 -8 1 -18 Z" fill={color} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
    <rect x="6" y="54" width="48" height="10" rx="3" fill="#D6D3D1" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
    <path d="M9 64 h42 l-3 42 a4 4 0 0 1 -4 4 h-28 a4 4 0 0 1 -4 -4 Z" fill={color} stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
    <ellipse cx="22" cy="80" rx="5" ry="9" fill="rgba(255,255,255,0.35)" />
  </svg>
);

/** A pink eraser. */
export const EraserIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 80 110" className={className} aria-hidden="true">
    <g transform="rotate(-25 40 60)">
      <rect x="18" y="20" width="44" height="80" rx="8" fill="#F9A8D4" stroke="rgba(0,0,0,0.25)" strokeWidth="2" />
      <rect x="18" y="62" width="44" height="38" rx="8" fill="#60A5FA" stroke="rgba(0,0,0,0.25)" strokeWidth="2" />
    </g>
  </svg>
);

export const ToolIcon: React.FC<{ tool: DrawTool; color: string; className?: string }> = ({ tool, color, className }) => {
  if (tool === 'crayon') return <CrayonIcon color={color} className={className} />;
  if (tool === 'marker') return <MarkerIcon color={color} className={className} />;
  if (tool === 'paint') return <PaintIcon color={color} className={className} />;
  return <EraserIcon className={className} />;
};

/** Paints one stroke segment from (x0,y0) to (x1,y1) in the look of the chosen tool. */
export function drawSegment(
  ctx: CanvasRenderingContext2D,
  tool: DrawTool,
  color: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  // Zero-length lines don't paint their round caps, so nudge a tap into a tiny line.
  if (x0 === x1 && y0 === y1) x1 += 0.01;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';

  const line = (width: number, style: string, alpha = 1, dx = 0, dy = 0) => {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.beginPath();
    ctx.moveTo(x0 + dx, y0 + dy);
    ctx.lineTo(x1 + dx, y1 + dy);
    ctx.stroke();
  };

  if (tool === 'marker') {
    line(18, color);
  } else if (tool === 'eraser') {
    line(64, '#FFFFFF');
  } else if (tool === 'paint') {
    line(40, color);
    // A few darker bristle streaks give it a brushed look.
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    const shade = darker(color, 0.25);
    for (const off of [-13, -4, 9]) line(2.5, shade, 0.18, nx * off, ny * off);
  } else {
    // Crayon: a faint waxy base plus speckled grain, so it looks rough like a real crayon.
    line(12, color, 0.35);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = color;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      for (let k = 0; k < 7; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 8;
        ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, 2);
      }
    }
  }
  ctx.restore();
}
