import { CONFIG } from './config';
import { dayKey } from './time';
import type { Progress } from './types';

export interface StreakSettlement {
  progress: Progress;
  /** Freezes spent to cover missed days. */
  freezesUsed: number;
  /** The streak that was lost (0 when nothing was lost). */
  streakLost: number;
}

/**
 * Account for the days that passed without focus. Called whenever the app is
 * opened and before a completed session is applied, so it works no matter how
 * long the app stayed closed.
 *
 * Each fully missed day costs one freeze. If there are not enough freezes to
 * cover every missed day the streak resets, and the freezes are kept: spending
 * them on a streak that is lost anyway would only add insult.
 */
export function settleStreak(progress: Progress, today: number): StreakSettlement {
  const last = progress.lastStreakDay;
  if (last == null || progress.streak === 0) return { progress, freezesUsed: 0, streakLost: 0 };
  const missed = today - last - 1;
  if (missed <= 0) return { progress, freezesUsed: 0, streakLost: 0 };

  if (missed <= progress.freezes) {
    const frozen: string[] = [];
    for (let d = last + 1; d < today; d++) frozen.push(dayKey(d));
    return {
      progress: {
        ...progress,
        freezes: progress.freezes - missed,
        lastStreakDay: today - 1,
        frozenDays: [...progress.frozenDays, ...frozen].slice(-60),
      },
      freezesUsed: missed,
      streakLost: 0,
    };
  }
  return {
    progress: { ...progress, streak: 0, lastStreakDay: null },
    freezesUsed: 0,
    streakLost: progress.streak,
  };
}

/** Count today for the streak (idempotent within a day). */
export function markStreakDay(progress: Progress, today: number): Progress {
  if (progress.lastStreakDay === today) return progress;
  const streak = progress.streak + 1;
  return { ...progress, streak, bestStreak: Math.max(progress.bestStreak, streak), lastStreakDay: today };
}

/** True when today has not been secured yet and a streak is on the line. */
export function streakAtRisk(progress: Progress, today: number): boolean {
  return progress.streak > 0 && progress.lastStreakDay !== today;
}

/** Freezes are earned by focusing, never bought. */
export function earnFreezes(progress: Progress, minutes: number): { progress: Progress; earned: number } {
  const { minutesPerFreeze, maxFreezes } = CONFIG.streak;
  let freezes = progress.freezes;
  let toward = progress.minutesTowardFreeze + Math.max(0, minutes);
  let earned = 0;
  while (toward >= minutesPerFreeze && freezes < maxFreezes) {
    toward -= minutesPerFreeze;
    freezes += 1;
    earned += 1;
  }
  // With a full pocket the meter rests: no hidden third freeze is banked.
  if (freezes >= maxFreezes) toward = 0;
  return { progress: { ...progress, freezes, minutesTowardFreeze: toward }, earned };
}

/** Progress of the daily ring: 1 = closed, above 1 = extra laps. */
export function ringProgress(progress: Progress, todayKey: string): number {
  const goal = Math.max(1, progress.dailyGoalMin);
  return (progress.days[todayKey] ?? 0) / goal;
}
