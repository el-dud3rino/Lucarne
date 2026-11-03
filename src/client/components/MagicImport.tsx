import React, { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, ClipboardPaste, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { NoticeBanner } from './NoticeBanner.js';
import { MemberChips, Sheet, inputClass, primaryBtn, secondaryBtn } from './Sheet.js';
import type { FamilyMember, MagicEventDraft } from '../../shared/types.js';

const MAX_SIDE = 2000;

/** Shrinks big phone photos before upload (faster, and well inside Gemini's limits). HEIC falls back to the original. */
async function prepareImage(file: File): Promise<{ data: string; mimeType: string }> {
  const readRaw = () =>
    new Promise<{ data: string; mimeType: string }>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ data: String(r.result).split(',')[1] || '', mimeType: file.type || 'image/jpeg' });
      r.onerror = () => reject(new Error('Could not read that photo'));
      r.readAsDataURL(file);
    });
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    URL.revokeObjectURL(url);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], mimeType: 'image/jpeg' };
  } catch {
    return readRaw();
  }
}

interface Row extends MagicEventDraft {
  key: string;
  include: boolean;
}

function toIsoRange(d: MagicEventDraft): { startIso: string; endIso: string } {
  if (d.allDay) return { startIso: `${d.date}T00:00:00.000Z`, endIso: `${d.endDate || d.date}T23:59:59.000Z` };
  const [y, m, day] = d.date.split('-').map(Number);
  const [ey, em, ed] = (d.endDate || d.date).split('-').map(Number);
  const [sh, sm] = d.startTime.split(':').map(Number);
  const [eh, emi] = (d.endTime || d.startTime).split(':').map(Number);
  return {
    startIso: new Date(y, m - 1, day, sh, sm).toISOString(),
    endIso: new Date(ey, em - 1, ed, eh, emi).toISOString(),
  };
}

export const MagicImportSheet: React.FC<{
  members: FamilyMember[];
  defaultMemberIds: string[];
  geminiConfigured: boolean;
  onClose: () => void;
}> = ({ members, defaultMemberIds, geminiConfigured, onClose }) => {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [image, setImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const prepared = await prepareImage(file);
      setImage(prepared);
      setPreview(`data:${prepared.mimeType};base64,${prepared.data}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const extract = async () => {
    setBusy('reading');
    setError(null);
    try {
      const res = await apiFetch<{ drafts: MagicEventDraft[] }>('/api/today/magic-import', {
        method: 'POST',
        body: JSON.stringify({ text, imageBase64: image?.data, mimeType: image?.mimeType }),
      });
      if (res.drafts.length === 0) {
        setError("Gemini didn't find any dated events. Try a sharper photo, or paste the text instead.");
        return;
      }
      setRows(
        res.drafts.map((d, i) => ({
          ...d,
          memberIds: d.memberIds.length ? d.memberIds : defaultMemberIds,
          key: `${i}-${d.date}-${d.title}`,
          include: true,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!rows) return;
    setBusy('saving');
    setError(null);
    let added = 0;
    try {
      for (const r of rows.filter((x) => x.include)) {
        const { startIso, endIso } = toIsoRange(r);
        await apiFetch('/api/events', {
          method: 'POST',
          body: JSON.stringify({ title: r.title, location: r.location, description: r.notes, allDay: r.allDay, startIso, endIso, memberIds: r.memberIds }),
        });
        added++;
      }
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setDone(`Added ${added} event${added === 1 ? '' : 's'} to the calendar.`);
      setRows(null);
      setText('');
      setImage(null);
      setPreview(null);
    } catch (e) {
      setError(`Added ${added}, then stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const update = (key: string, patch: Partial<Row>) => setRows((prev) => prev?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);
  const included = rows?.filter((r) => r.include).length ?? 0;

  return (
    <Sheet
      title={
        <>
          <Wand2 className="w-5 h-5 text-violet-500" /> Magic Import
        </>
      }
      subtitle="Snap a school flyer, sports schedule or invitation — or paste an email — and Gemini finds the dates. You check everything before it's added."
      onClose={onClose}
      maxWidth="max-w-2xl"
      testId="magic-import"
      footer={
        rows ? (
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => setRows(null)} className={secondaryBtn}>
              Back
            </button>
            <button type="button" onClick={save} disabled={included === 0 || busy !== null} className={`${primaryBtn} flex items-center gap-2`}>
              {busy === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
              Add {included} event{included === 1 ? '' : 's'}
            </button>
          </div>
        ) : undefined
      }
    >
      {!geminiConfigured && (
        <NoticeBanner tone="info" text="Magic Import uses Gemini. Add a free Gemini API key in Settings → AI Recipe Extraction first." />
      )}
      {error && <NoticeBanner tone="error" text={error} onDismiss={() => setError(null)} />}
      {done && <NoticeBanner tone="success" text={done} onDismiss={() => setDone(null)} />}

      {!rows && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="min-h-[120px] rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50/60 hover:bg-violet-50 flex flex-col items-center justify-center gap-2 text-violet-800 font-bold active:scale-[0.99] overflow-hidden"
            >
              {preview ? (
                <img src={preview} alt="Selected" className="max-h-40 rounded-xl object-contain" />
              ) : (
                <>
                  <Camera className="w-8 h-8" />
                  Take or choose a photo
                </>
              )}
            </button>
            <div className="flex flex-col gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="…or paste the email / text here"
                aria-label="Text to import"
                className="flex-1 min-h-[120px] p-3 rounded-2xl bg-stone-50 border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    setText(await navigator.clipboard.readText());
                  } catch {
                    setError('This browser blocked reading the clipboard. Long-press the box and choose Paste.');
                  }
                }}
                className="h-10 min-h-[40px] rounded-xl bg-stone-100 text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5"
              >
                <ClipboardPaste className="w-4 h-4" /> Paste from clipboard
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={extract}
            disabled={(!image && !text.trim()) || busy !== null || !geminiConfigured}
            className="w-full h-13 min-h-[52px] rounded-2xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-extrabold flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            {busy === 'reading' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            {busy === 'reading' ? 'Reading…' : 'Find events'}
          </button>
        </>
      )}

      {rows && (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.key} className={`rounded-2xl border p-3 space-y-2.5 transition ${r.include ? 'border-violet-200 bg-white' : 'border-stone-200 bg-stone-50 opacity-60'}`}>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={(e) => update(r.key, { include: e.target.checked })}
                  aria-label={`Include ${r.title}`}
                  className="w-6 h-6 accent-violet-600 shrink-0"
                />
                <input value={r.title} onChange={(e) => update(r.key, { title: e.target.value })} className={`${inputClass} h-11`} aria-label="Event title" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" value={r.date} onChange={(e) => update(r.key, { date: e.target.value, endDate: e.target.value > r.endDate ? e.target.value : r.endDate })} className="h-11 px-3 rounded-xl bg-stone-50 border border-stone-200 text-sm font-semibold" />
                {r.allDay ? (
                  <span className="text-xs font-bold text-stone-500 px-2">All day{r.endDate !== r.date ? ` → ${r.endDate}` : ''}</span>
                ) : (
                  <>
                    <input type="time" value={r.startTime} onChange={(e) => update(r.key, { startTime: e.target.value })} className="h-11 px-3 rounded-xl bg-stone-50 border border-stone-200 text-sm font-semibold" />
                    <span className="text-stone-400">–</span>
                    <input type="time" value={r.endTime} onChange={(e) => update(r.key, { endTime: e.target.value })} className="h-11 px-3 rounded-xl bg-stone-50 border border-stone-200 text-sm font-semibold" />
                  </>
                )}
                <button
                  type="button"
                  onClick={() =>
                    update(r.key, r.allDay ? { allDay: false, startTime: '09:00', endTime: '10:00' } : { allDay: true, startTime: '', endTime: '' })
                  }
                  className="h-10 min-h-[40px] px-3 rounded-xl bg-stone-100 text-xs font-bold text-slate-700"
                >
                  {r.allDay ? 'Add time' : 'All day'}
                </button>
              </div>
              {(r.location || r.notes) && (
                <div className="text-xs text-stone-500 space-y-0.5">
                  {r.location && <div>📍 {r.location}</div>}
                  {r.notes && <div className="line-clamp-2">📝 {r.notes}</div>}
                </div>
              )}
              <MemberChips members={members} value={r.memberIds} onChange={(memberIds) => update(r.key, { memberIds })} />
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
};
