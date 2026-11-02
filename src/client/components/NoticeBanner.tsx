import React, { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy, Info, X } from 'lucide-react';

export type NoticeTone = 'success' | 'info' | 'error';

/** Renders text with any http(s) URLs as tappable links. */
export const Linkify: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="underline break-all font-semibold">
            {part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
};

/** Copies text; falls back to execCommand on plain-http LAN origins where navigator.clipboard is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export const CopyButton: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      className={`h-10 min-h-[40px] min-w-[40px] px-3 rounded-xl bg-white/70 hover:bg-white border border-current/20 text-xs font-bold flex items-center gap-1.5 shrink-0 ${className}`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

const TONES: Record<NoticeTone, { box: string; Icon: typeof Info }> = {
  success: { box: 'bg-emerald-50 border-emerald-200 text-emerald-900', Icon: CheckCircle2 },
  info: { box: 'bg-sky-50 border-sky-200 text-sky-900', Icon: Info },
  error: { box: 'bg-rose-50 border-rose-200 text-rose-800', Icon: AlertTriangle },
};

/** Status/error notice. Text is selectable (the kiosk otherwise disables selection) and errors offer Copy. */
export const NoticeBanner: React.FC<{ text: string; tone: NoticeTone; onDismiss?: () => void }> = ({
  text,
  tone,
  onDismiss,
}) => {
  const { box, Icon } = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`p-3 rounded-2xl border flex items-start gap-3 text-sm ${box}`}>
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 font-semibold select-text break-words">
        <Linkify text={text} />
      </div>
      {tone === 'error' && <CopyButton text={text} />}
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="h-10 w-10 min-h-[40px] min-w-[40px] rounded-xl hover:bg-white/60 flex items-center justify-center shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
