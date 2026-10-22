import {
  DAY_MS,
  dayKey,
  forEachSlice,
  isLateNight,
  isWeekend,
  localParts,
  round1,
} from '../../insights/team-time';

/*
 * Turns raw Google Calendar events into "meeting load" numbers for one person.
 *
 * Pure functions only (no Nest, no HTTP), so they are easy to unit test.
 *
 * Privacy: only times and counts leave this file. Event titles, descriptions,
 * attendees and locations are never read into the result, never stored and
 * never sent to the AI.
 */

/** The few fields of a Google Calendar event that AgiliX reads. */
export interface RawCalendarEvent {
  status?: string; // "confirmed" | "tentative" | "cancelled"
  eventType?: string; // "default" | "outOfOffice" | "focusTime" | "workingLocation" | ...
  transparency?: string; // "opaque" (busy, the default) | "transparent" (free)
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
}

/** Meeting load of one person. All numbers are measured, not guessed. */
export interface CalendarLoad {
  /** Hours spent in meetings in the window (overlapping meetings counted once). */
  meetingHours: number;
  meetings: number;
  /** Days with at least one meeting. */
  meetingDays: number;
  /** Most meeting hours on a single day. */
  heaviestDayHours: number;
  /** Average meeting hours per working day (Mon–Fri) in the window. */
  avgHoursPerWorkday: number;
  lateNightMeetingHours: number;
  weekendMeetingHours: number;
  /** Meetings that start less than 10 minutes after the previous one ended. */
  backToBackMeetings: number;
  /** Days with 4 or more meetings (little time left for focused work). */
  fragmentedDays: number;
  /** Days marked "Out of office" in the window. */
  outOfOfficeDays: number;
  /** Looking ahead: the next 7 days. Used for sprint capacity. */
  next7Days: { meetingHours: number; meetings: number; outOfOfficeDays: number };
}

export const BACK_TO_BACK_GAP_MS = 10 * 60_000;
export const FRAGMENTED_DAY_MEETINGS = 4;
export const LOOKAHEAD_DAYS = 7;
/** A single "meeting" longer than this is a block of time (travel, training), not a meeting. */
const MAX_MEETING_MS = 10 * 3_600_000;

interface Span {
  start: number;
  end: number;
}

/** Parses an event into a timed meeting span, or null when it is not a meeting. */
export function toMeeting(event: RawCalendarEvent): Span | null {
  if (event.status === 'cancelled') return null;
  if (event.eventType && event.eventType !== 'default') return null; // OOO, focus time, working location...
  if (event.transparency === 'transparent') return null; // marked "free"
  const self = event.attendees?.find((a) => a.self);
  if (self?.responseStatus === 'declined') return null;
  // All-day events (date only) are not meetings.
  if (!event.start?.dateTime || !event.end?.dateTime) return null;
  const start = Date.parse(event.start.dateTime);
  const end = Date.parse(event.end.dateTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  if (end - start > MAX_MEETING_MS) return null;
  return { start, end };
}

/** Out-of-office days covered by the event (team-time day keys), clipped to [from, to). */
export function outOfOfficeDays(
  event: RawCalendarEvent,
  from: number,
  to: number,
  timeZone: string,
): string[] {
  if (event.status === 'cancelled' || event.eventType !== 'outOfOffice') return [];
  const start = parseBoundary(event.start);
  const end = parseBoundary(event.end);
  if (start === null || end === null || end <= start) return [];
  const days = new Set<string>();
  for (let t = Math.max(start, from); t < Math.min(end, to); t += 3_600_000) {
    days.add(dayKey(t, timeZone));
  }
  return [...days];
}

function parseBoundary(b: RawCalendarEvent['start']): number | null {
  if (!b) return null;
  const value = b.dateTime ?? (b.date ? `${b.date}T00:00:00Z` : undefined);
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** Merges overlapping spans so double-booked time is counted once. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** Number of Mon–Fri days in [from, to) in the team time zone. */
export function countWorkdays(from: number, to: number, timeZone: string): number {
  const seen = new Set<string>();
  for (let t = from; t < to; t += 3_600_000) {
    if (!isWeekend(localParts(t, timeZone).weekday)) seen.add(dayKey(t, timeZone));
  }
  return seen.size;
}

/**
 * Meeting load for the window [since, now) plus the next 7 days after `now`.
 * `events` should cover both ranges.
 */
export function computeCalendarLoad(
  events: RawCalendarEvent[],
  options: { since: number; now: number; timeZone: string },
): CalendarLoad {
  const { since, now, timeZone } = options;
  const lookaheadEnd = now + LOOKAHEAD_DAYS * DAY_MS;

  const meetings = events.map(toMeeting).filter((m): m is Span => m !== null);
  const past = meetings.filter((m) => m.start >= since && m.start < now).map((m) => ({
    start: m.start,
    end: Math.min(m.end, now),
  }));
  const upcoming = meetings.filter((m) => m.start >= now && m.start < lookaheadEnd);

  // Hours per day, late-night and weekend hours (overlaps merged first).
  const hoursByDay = new Map<string, number>();
  let lateMs = 0;
  let weekendMs = 0;
  let totalMs = 0;
  for (const span of mergeSpans(past)) {
    totalMs += span.end - span.start;
    forEachSlice(span.start, span.end, (at, ms) => {
      const key = dayKey(at, timeZone);
      hoursByDay.set(key, (hoursByDay.get(key) ?? 0) + ms / 3_600_000);
      const { hour, weekday } = localParts(at, timeZone);
      if (isLateNight(hour)) lateMs += ms;
      if (isWeekend(weekday)) weekendMs += ms;
    });
  }

  // Meetings per day and back-to-back meetings (counted per meeting, not merged).
  const countByDay = new Map<string, number>();
  for (const m of past) {
    const key = dayKey(m.start, timeZone);
    countByDay.set(key, (countByDay.get(key) ?? 0) + 1);
  }
  const sortedPast = [...past].sort((a, b) => a.start - b.start);
  let backToBack = 0;
  let latestEnd = -Infinity;
  for (const m of sortedPast) {
    const gap = m.start - latestEnd;
    if (gap >= 0 && gap < BACK_TO_BACK_GAP_MS) backToBack += 1;
    latestEnd = Math.max(latestEnd, m.end);
  }

  const oooPast = new Set<string>();
  const oooNext = new Set<string>();
  for (const event of events) {
    for (const day of outOfOfficeDays(event, since, now, timeZone)) oooPast.add(day);
    for (const day of outOfOfficeDays(event, now, lookaheadEnd, timeZone)) oooNext.add(day);
  }

  const workdays = countWorkdays(since, now, timeZone);
  const dailyHours = [...hoursByDay.values()];
  const totalHours = totalMs / 3_600_000;
  const upcomingMs = mergeSpans(upcoming).reduce((sum, s) => sum + (s.end - s.start), 0);

  return {
    meetingHours: round1(totalHours),
    meetings: past.length,
    meetingDays: countByDay.size,
    heaviestDayHours: round1(dailyHours.length ? Math.max(...dailyHours) : 0),
    avgHoursPerWorkday: round1(workdays ? totalHours / workdays : 0),
    lateNightMeetingHours: round1(lateMs / 3_600_000),
    weekendMeetingHours: round1(weekendMs / 3_600_000),
    backToBackMeetings: backToBack,
    fragmentedDays: [...countByDay.values()].filter((n) => n >= FRAGMENTED_DAY_MEETINGS).length,
    outOfOfficeDays: oooPast.size,
    next7Days: {
      meetingHours: round1(upcomingMs / 3_600_000),
      meetings: upcoming.length,
      outOfOfficeDays: oooNext.size,
    },
  };
}

/** Days with at least one meeting (team-time keys), so meeting days count towards working streaks. */
export function meetingDayKeys(
  events: RawCalendarEvent[],
  since: number,
  now: number,
  timeZone: string,
): string[] {
  const days = new Set<string>();
  for (const m of events.map(toMeeting)) {
    if (m && m.start >= since && m.start < now) days.add(dayKey(m.start, timeZone));
  }
  return [...days];
}
