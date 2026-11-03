import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../db/connection.js';
import { generateWithCurrentModel, getGeminiApiKey } from './recipes.js';
import { localDateStr } from '../../shared/chores.js';
import type { MagicEventDraft } from '../../shared/types.js';

/**
 * "Magic Import": turn a photo of a school flyer / sports schedule / party invite, or pasted email
 * text, into draft calendar events. Nothing is saved here — the family reviews the drafts first.
 */

export type { MagicEventDraft };

export interface MagicImportInput {
  text?: string;
  imageBase64?: string;
  mimeType?: string;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function normTime(v: unknown): string {
  const m = String(v ?? '').trim().match(TIME_RE);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

function addHour(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Cleans Gemini's answer: drops events without a valid date/title, fixes times, maps people's names
 * to member ids, removes duplicates and sorts by date. Exported for tests.
 */
export function normalizeMagicDrafts(
  raw: unknown,
  members: Array<{ id: string; name: string }>
): MagicEventDraft[] {
  const list = Array.isArray((raw as { events?: unknown })?.events) ? (raw as { events: unknown[] }).events : Array.isArray(raw) ? raw : [];
  const byName = new Map(members.map((m) => [m.name.trim().toLowerCase(), m.id]));
  const seen = new Set<string>();
  const out: MagicEventDraft[] = [];
  for (const item of list.slice(0, 60)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const title = String(r.title ?? '').trim().slice(0, 120);
    const date = String(r.date ?? '').trim();
    if (!title || !DATE_RE.test(date) || Number.isNaN(Date.parse(date))) continue;
    let endDate = String(r.endDate ?? '').trim();
    if (!DATE_RE.test(endDate) || endDate < date) endDate = date;
    let startTime = normTime(r.startTime);
    let endTime = normTime(r.endTime);
    let allDay = Boolean(r.allDay) || !startTime;
    if (allDay) {
      startTime = '';
      endTime = '';
    } else if (!endTime || (endDate === date && endTime <= startTime)) {
      endTime = addHour(startTime);
    }
    const people = Array.isArray(r.people) ? r.people : [];
    const memberIds = [
      ...new Set(
        people
          .map((p) => byName.get(String(p).trim().toLowerCase()))
          .filter((x): x is string => Boolean(x))
      ),
    ];
    const key = `${title.toLowerCase()}|${date}|${startTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      date,
      endDate,
      startTime,
      endTime,
      allDay,
      location: String(r.location ?? '').trim().slice(0, 200),
      notes: String(r.notes ?? '').trim().slice(0, 500),
      memberIds,
    });
  }
  return out.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

export async function extractEventsWithGemini(input: MagicImportInput): Promise<MagicEventDraft[]> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('Magic Import needs a Gemini API key. Add one in Settings → AI.');
  const text = (input.text || '').trim().slice(0, 40_000);
  const image = (input.imageBase64 || '').replace(/^data:[^,]+,/, '');
  if (!text && !image) throw new Error('Add a photo or paste some text first.');
  const mimeType = (input.mimeType || 'image/jpeg').toLowerCase();
  if (image) {
    if (!IMAGE_TYPES.has(mimeType)) throw new Error('Use a JPEG, PNG, WebP or HEIC photo.');
    if ((image.length * 3) / 4 > MAX_IMAGE_BYTES) throw new Error('That photo is too large (over 8 MB).');
  }

  const members = db.prepare("SELECT id, name FROM family_members WHERE role != 'family' ORDER BY sort_order").all() as Array<{
    id: string;
    name: string;
  }>;
  const today = new Date();
  const prompt = [
    `Today is ${today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${localDateStr(today)}).`,
    'Find every dated event, deadline, practice, game, party, appointment or school day-off in the',
    image ? 'attached photo (a flyer, schedule, invitation, screenshot or school notice)' : 'text below (usually a school or club email)',
    'and list them as calendar events.',
    'Rules: use the exact dates written. When the year is missing, use the next date on or after today.',
    'Times are 24-hour HH:MM in local time. If no time is given, set allDay true and leave the times empty.',
    'For multi-day events set endDate to the last day. Keep titles short (under 8 words) and specific,',
    'e.g. "Picture Day", "Soccer vs. Eagles". Put useful details (what to bring, dress code, cost) in notes.',
    'Do not invent events. If nothing has a date, return an empty list.',
    members.length
      ? `Family members: ${members.map((m) => m.name).join(', ')}. In "people", list the ones the event is clearly for (names exactly as written here); otherwise leave it empty.`
      : 'Leave "people" empty.',
    text ? `\n---\n${text}` : '',
  ].join(' ');

  const ai = new GoogleGenAI({ apiKey });
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (image) parts.push({ inlineData: { mimeType, data: image } });

  const response = await generateWithCurrentModel(
    ai,
    {
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            events: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  date: { type: Type.STRING, description: 'YYYY-MM-DD' },
                  endDate: { type: Type.STRING, description: 'YYYY-MM-DD, same as date for one-day events' },
                  startTime: { type: Type.STRING, description: 'HH:MM 24h or empty' },
                  endTime: { type: Type.STRING, description: 'HH:MM 24h or empty' },
                  allDay: { type: Type.BOOLEAN },
                  location: { type: Type.STRING },
                  notes: { type: Type.STRING },
                  people: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['title', 'date', 'allDay'],
              },
            },
          },
          required: ['events'],
        },
      },
    },
    image ? 'heavy' : 'light'
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text || '{}');
  } catch {
    throw new Error('Gemini returned something unreadable. Try again, or try a sharper photo.');
  }
  return normalizeMagicDrafts(parsed, members);
}
