import { CONFIG, DAY_MS, HOUR_MS } from './config';

/**
 * Integer index of the "focus day" a timestamp belongs to. Days roll over at
 * 04:00 local time. `tzOffsetMin` follows `Date.getTimezoneOffset()` (minutes
 * to add to local time to reach UTC) and is injectable for tests.
 */
export function dayIndex(ts: number, tzOffsetMin: number = new Date(ts).getTimezoneOffset()): number {
  return Math.floor((ts - tzOffsetMin * 60_000 - CONFIG.dayRolloverHour * HOUR_MS) / DAY_MS);
}

/** "YYYY-MM-DD" for a day index. */
export function dayKey(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

export function dayKeyAt(ts: number, tzOffsetMin?: number): string {
  return dayKey(dayIndex(ts, tzOffsetMin));
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayOf(index: number): number {
  // Day index 0 is 1970-01-01, a Thursday.
  return (((index + 3) % 7) + 7) % 7;
}

/** Day index of the Monday that starts the week containing `index`. */
export function weekStart(index: number): number {
  return index - weekdayOf(index);
}

/** ISO-8601 week number of a day index. */
export function isoWeek(index: number): number {
  const thursday = weekStart(index) + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const jan1 = Math.floor(Date.UTC(year, 0, 1) / DAY_MS);
  return Math.floor((thursday - jan1) / 7) + 1;
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`;
}

export function formatMinutes(min: number): string {
  const m = Math.floor(min + 1e-6);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}
