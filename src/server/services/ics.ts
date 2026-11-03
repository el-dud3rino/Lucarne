/**
 * Small, dependency-free iCalendar (.ics) reader for read-only calendar feeds: school districts,
 * sports apps (TeamSnap, GameChanger...), iCloud public calendars, Outlook "publish calendar" links.
 *
 * Handles line folding, all-day vs timed events, UTC / floating / TZID times (IANA names plus the
 * common Windows names Outlook uses), RRULE (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT,
 * UNTIL, BYDAY), EXDATE, RECURRENCE-ID overrides and cancelled events.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  description: string;
  location: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface RawEvent {
  props: Prop[];
}

const WINDOWS_TZ: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  UTC: 'UTC',
};

function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else if (line.trim()) {
      out.push(line);
    }
  }
  return out;
}

function parseProp(line: string): Prop | null {
  // NAME;PARAM=a;PARAM2="b:c":VALUE  (colons can appear inside quoted params)
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(';');
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

export function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/** Offset (ms) of an IANA zone from UTC at a given instant. */
function zoneOffsetMs(timeZone: string, at: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(at))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

function resolveZone(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const name = WINDOWS_TZ[tzid] || tzid;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return name;
  } catch {
    return null;
  }
}

/** Wall-clock time in a zone -> UTC epoch ms (null zone = this machine's local time). */
export function wallTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  zone: string | null
): number {
  if (!zone) return new Date(y, mo - 1, d, h, mi, s).getTime();
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ts = guess - zoneOffsetMs(zone, guess);
  // Second pass settles times near a DST change.
  ts = guess - zoneOffsetMs(zone, ts);
  return ts;
}

interface ParsedTime {
  allDay: boolean;
  /** For all-day: YYYY-MM-DD; for timed: epoch ms */
  date: string;
  ms: number;
  /** Components for recurrence math in the event's own zone */
  parts: { y: number; mo: number; d: number; h: number; mi: number; s: number };
  zone: string | null;
  utc: boolean;
}

function parseTime(prop: Prop | undefined): ParsedTime | null {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || prop.params.VALUE === 'DATE') {
    return { allDay: true, date, ms: Date.UTC(y, mo - 1, d), parts: { y, mo, d, h: 0, mi: 0, s: 0 }, zone: null, utc: false };
  }
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] || 0);
  const utc = m[7] === 'Z';
  const zone = utc ? 'UTC' : resolveZone(prop.params.TZID);
  return { allDay: false, date, ms: wallTimeToUtc(y, mo, d, h, mi, s, zone), parts: { y, mo, d, h, mi, s }, zone, utc };
}

function parseDuration(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms =
    (Number(m[2] || 0) * 7 * 86400 + Number(m[3] || 0) * 86400 + Number(m[4] || 0) * 3600 + Number(m[5] || 0) * 60 + Number(m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function dateStrFromParts(y: number, mo: number, d: number): string {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.toISOString().slice(0, 10);
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const dt = new Date(`${dateStr}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Safety cap on generated occurrences per series (a daily series over 20+ years). */
const MAX_OCCURRENCES = 10_000;

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  untilMs: number | null;
  byDay: number[];
}

function parseRule(v: string | undefined): Rule | null {
  if (!v) return null;
  const map: Record<string, string> = {};
  for (const part of v.split(';')) {
    const [k, val] = part.split('=');
    if (k && val) map[k.toUpperCase()] = val;
  }
  const freq = map.FREQ as Rule['freq'];
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  let untilMs: number | null = null;
  if (map.UNTIL) {
    const t = parseTime({ name: 'UNTIL', params: {}, value: map.UNTIL });
    if (t) untilMs = t.allDay ? t.ms + 86_399_000 : t.ms;
  }
  const byDay = (map.BYDAY || '')
    .split(',')
    .map((x) => DAY_CODES.indexOf(x.replace(/^[+-]?\d+/, '')))
    .filter((x) => x >= 0);
  return {
    freq,
    interval: Math.max(1, Number(map.INTERVAL || 1)),
    count: map.COUNT ? Math.max(1, Number(map.COUNT)) : null,
    untilMs,
    byDay,
  };
}

/**
 * Occurrence start dates (as {y,mo,d} in the event's own calendar) of a recurring series, up to windowEnd.
 * Times keep the same wall-clock time in the event's zone.
 */
function* recurrenceDates(start: ParsedTime, rule: Rule, windowEndMs: number): Generator<{ y: number; mo: number; d: number }> {
  const { y, mo, d } = start.parts;
  const base = new Date(Date.UTC(y, mo - 1, d));
  let emitted = 0;
  const done = (dt: Date) => {
    const ms = dt.getTime();
    return ms > windowEndMs + 86_400_000 || (rule.untilMs !== null && ms > rule.untilMs + 86_400_000) || emitted >= MAX_OCCURRENCES;
  };
  const emitOk = (dt: Date) => {
    if (rule.untilMs !== null) {
      const startMs = start.allDay
        ? dt.getTime()
        : wallTimeToUtc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), start.parts.h, start.parts.mi, start.parts.s, start.zone);
      if (startMs > rule.untilMs) return false;
    }
    return true;
  };

  if (rule.freq === 'WEEKLY' && rule.byDay.length > 0) {
    // Walk week by week (week containing the start), emitting each BYDAY on/after the start.
    const weekStart = new Date(base);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const days = [...rule.byDay].sort((a, b) => a - b);
    for (let w = 0; ; w += rule.interval) {
      for (const dow of days) {
        const dt = new Date(weekStart);
        dt.setUTCDate(weekStart.getUTCDate() + w * 7 + dow);
        if (dt < base) continue;
        if (done(dt)) return;
        if (!emitOk(dt)) return;
        if (rule.count !== null && emitted >= rule.count) return;
        emitted++;
        yield { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
      }
    }
  }

  for (let n = 0; ; n++) {
    let dt: Date;
    if (rule.freq === 'DAILY') {
      dt = new Date(base);
      dt.setUTCDate(base.getUTCDate() + n * rule.interval);
    } else if (rule.freq === 'WEEKLY') {
      dt = new Date(base);
      dt.setUTCDate(base.getUTCDate() + n * 7 * rule.interval);
    } else if (rule.freq === 'MONTHLY') {
      const target = mo - 1 + n * rule.interval;
      const yy = y + Math.floor(target / 12);
      const mm = ((target % 12) + 12) % 12;
      const dim = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
      if (d > dim) continue; // RFC 5545: skip months without that day
      dt = new Date(Date.UTC(yy, mm, d));
    } else {
      const yy = y + n * rule.interval;
      if (mo === 2 && d === 29 && new Date(Date.UTC(yy, 1, 29)).getUTCMonth() !== 1) continue;
      dt = new Date(Date.UTC(yy, mo - 1, d));
    }
    if (done(dt)) return;
    if (!emitOk(dt)) return;
    if (rule.count !== null && emitted >= rule.count) return;
    emitted++;
    yield { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
}

function getProp(ev: RawEvent, name: string): Prop | undefined {
  return ev.props.find((p) => p.name === name);
}

function exdateKeys(ev: RawEvent): Set<string> {
  const keys = new Set<string>();
  for (const p of ev.props.filter((x) => x.name === 'EXDATE')) {
    for (const v of p.value.split(',')) {
      const t = parseTime({ name: 'EXDATE', params: p.params, value: v });
      if (t) keys.add(t.allDay ? t.date : String(t.ms));
      if (t) keys.add(t.date); // tolerate date-only EXDATE against timed series
    }
  }
  return keys;
}

/**
 * Parses an .ics document into concrete events overlapping [windowStartMs, windowEndMs].
 * Throws if the text is not an iCalendar document.
 */
export function parseIcs(text: string, windowStartMs: number, windowEndMs: number): { calendarName: string | null; events: IcsEvent[] } {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That link did not return a calendar (.ics) file.');
  const lines = unfold(text);
  const raw: RawEvent[] = [];
  let calendarName: string | null = null;
  let current: RawEvent | null = null;
  let depth = 0; // nested components inside VEVENT (VALARM)
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      current = { props: [] };
      depth = 0;
      continue;
    }
    if (upper === 'END:VEVENT') {
      if (current) raw.push(current);
      current = null;
      continue;
    }
    if (current) {
      if (upper.startsWith('BEGIN:')) depth++;
      else if (upper.startsWith('END:')) depth = Math.max(0, depth - 1);
      else if (depth === 0) {
        const p = parseProp(line);
        if (p) current.props.push(p);
      }
    } else if (upper.startsWith('X-WR-CALNAME:')) {
      calendarName = unescapeText(line.slice(line.indexOf(':') + 1)) || null;
    }
  }

  // Overrides of single occurrences (RECURRENCE-ID) replace the generated instance.
  const overrides = new Map<string, Set<string>>();
  for (const ev of raw) {
    const rid = parseTime(getProp(ev, 'RECURRENCE-ID'));
    const uid = getProp(ev, 'UID')?.value || '';
    if (rid && uid) {
      if (!overrides.has(uid)) overrides.set(uid, new Set());
      overrides.get(uid)!.add(rid.allDay ? rid.date : String(rid.ms));
      overrides.get(uid)!.add(rid.date);
    }
  }

  const out: IcsEvent[] = [];
  const push = (base: Omit<IcsEvent, 'startIso' | 'endIso' | 'allDay'>, allDay: boolean, startMsOrDate: number | string, endMsOrDate: number | string) => {
    let startIso: string;
    let endIso: string;
    let sMs: number;
    let eMs: number;
    if (allDay) {
      const s = String(startMsOrDate);
      const eIncl = String(endMsOrDate);
      startIso = `${s}T00:00:00.000Z`;
      endIso = `${eIncl}T23:59:59.000Z`;
      sMs = Date.parse(startIso);
      eMs = Date.parse(endIso);
    } else {
      sMs = Number(startMsOrDate);
      eMs = Math.max(Number(endMsOrDate), sMs);
      startIso = new Date(sMs).toISOString();
      endIso = new Date(eMs).toISOString();
    }
    if (eMs < windowStartMs || sMs > windowEndMs) return;
    out.push({ ...base, startIso, endIso, allDay });
  };

  for (const ev of raw) {
    const status = getProp(ev, 'STATUS')?.value.toUpperCase();
    if (status === 'CANCELLED') continue;
    const start = parseTime(getProp(ev, 'DTSTART'));
    if (!start) continue;
    const uid = getProp(ev, 'UID')?.value || `${getProp(ev, 'SUMMARY')?.value || 'event'}-${start.date}`;
    const base = {
      uid,
      title: unescapeText(getProp(ev, 'SUMMARY')?.value || 'Untitled event'),
      description: unescapeText(getProp(ev, 'DESCRIPTION')?.value || '').slice(0, 2000),
      location: unescapeText(getProp(ev, 'LOCATION')?.value || ''),
    };
    const endProp = parseTime(getProp(ev, 'DTEND'));
    const duration = parseDuration(getProp(ev, 'DURATION')?.value);

    // All-day span in days (DTEND is exclusive) or timed duration in ms
    let spanDays = 0;
    let durMs = 0;
    if (start.allDay) {
      if (endProp) {
        const days = Math.round((endProp.ms - start.ms) / 86_400_000);
        spanDays = Math.max(0, days - 1);
      } else if (duration) {
        spanDays = Math.max(0, Math.round(duration / 86_400_000) - 1);
      }
    } else {
      durMs = endProp ? Math.max(0, endProp.ms - start.ms) : duration ?? 0;
    }

    const rule = parseRule(getProp(ev, 'RRULE')?.value);
    const isOverride = Boolean(getProp(ev, 'RECURRENCE-ID'));
    if (!rule || isOverride) {
      if (start.allDay) push(base, true, start.date, addDaysToDateStr(start.date, spanDays));
      else push(base, false, start.ms, start.ms + durMs);
      continue;
    }

    const ex = exdateKeys(ev);
    const ov = overrides.get(uid) ?? new Set<string>();
    for (const occ of recurrenceDates(start, rule, windowEndMs)) {
      const dateStr = dateStrFromParts(occ.y, occ.mo, occ.d);
      if (start.allDay) {
        if (ex.has(dateStr) || ov.has(dateStr)) continue;
        push({ ...base, uid: `${uid}#${dateStr}` }, true, dateStr, addDaysToDateStr(dateStr, spanDays));
      } else {
        const sMs = wallTimeToUtc(occ.y, occ.mo, occ.d, start.parts.h, start.parts.mi, start.parts.s, start.zone);
        if (ex.has(String(sMs)) || ex.has(dateStr) || ov.has(String(sMs)) || ov.has(dateStr)) continue;
        push({ ...base, uid: `${uid}#${dateStr}` }, false, sMs, sMs + durMs);
      }
    }
  }

  out.sort((a, b) => a.startIso.localeCompare(b.startIso));
  return { calendarName, events: out };
}
