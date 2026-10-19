/**
 * Small time helpers for team insights. All "late night", "weekend" and
 * "day" logic uses the team's time zone (TEAM_TIMEZONE, default Asia/Kolkata),
 * because a commit at 17:30 UTC is 23:00 in India.
 */

export const DAY_MS = 86_400_000;
const HALF_HOUR_MS = 1_800_000;

/** 22:00–06:00 team time counts as late night. */
export const LATE_START_HOUR = 22;
export const LATE_END_HOUR = 6;

export function teamTimeZone(): string {
  return process.env.TEAM_TIMEZONE?.trim() || 'Asia/Kolkata';
}

/** "YYYY-MM-DD" of a moment in the given time zone. */
export function dayKey(time: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(time));
}

/** Hour (0–23) and short weekday ("Mon") of a moment in the given time zone. */
export function localParts(time: number, timeZone: string): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date(time));
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0),
    weekday: parts.find((p) => p.type === 'weekday')?.value ?? '',
  };
}

export function isLateNight(hour: number): boolean {
  return hour >= LATE_START_HOUR || hour < LATE_END_HOUR;
}

export function isWeekend(weekday: string): boolean {
  return weekday === 'Sat' || weekday === 'Sun';
}

/**
 * Splits a time span into half-hour slices (aligned to UTC half hours, which
 * are also half-hour boundaries in India and most other zones) and calls `visit`
 * with each slice's start and length. Used to count how much of a tracked
 * session fell late at night, on a weekend, or on which day.
 */
export function forEachSlice(start: number, end: number, visit: (at: number, ms: number) => void): void {
  let t = start;
  while (t < end) {
    const next = Math.min(end, Math.floor(t / HALF_HOUR_MS) * HALF_HOUR_MS + HALF_HOUR_MS);
    visit(t, next - t);
    t = next;
  }
}

/** Longest run of consecutive calendar days (YYYY-MM-DD keys) in the set. */
export function longestStreak(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const key of sorted) {
    const time = Date.parse(`${key}T00:00:00Z`);
    run = previous !== null && time - previous === DAY_MS ? run + 1 : 1;
    best = Math.max(best, run);
    previous = time;
  }
  return best;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
