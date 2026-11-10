export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export type WitherReason = 'left' | 'gaveUp' | 'interrupted';

export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  outcome: 'completed' | 'withered';
  witherReason?: WitherReason;
  stake: number;
  /** Coins returned from the wager (0 when there was no stake or it was lost). */
  payout: number;
  coinsEarned: number;
  seedId?: string;
}

export interface ActiveSession {
  id: string;
  startedAt: number;
  durationSec: number;
  stake: number;
  /** Set while the app is in the background, null while it is in front. */
  leftAt: number | null;
  gracesUsed: number;
}

export interface Seed {
  id: string;
  speciesId: string;
  rarity: Rarity;
  earnedAt: number;
  source: 'session' | 'pouch';
  /** "x,y" of the tile it grows on, or null while it waits in the seed tray. */
  tile: string | null;
  plantedAt: number | null;
}

export interface World {
  /** tile key "x,y" -> seed id */
  tiles: Record<string, string>;
  radius: number;
  /** Vitality (0..1) as it was at `vitalityAt`. Use `vitalityNow` to read it. */
  vitality: number;
  vitalityAt: number;
  /** Fading is paused until this moment. Null until the first completed session. */
  graceUntil: number | null;
}

export interface Economy {
  coins: number;
  lifetimeFocusMin: number;
  lifetimeSessions: number;
}

export interface Progress {
  dailyGoalMin: number;
  /** "YYYY-MM-DD" (4am rollover) -> focused minutes */
  days: Record<string, number>;
  streak: number;
  bestStreak: number;
  /** Day index of the last day that counted for the streak (focused or frozen). */
  lastStreakDay: number | null;
  freezes: number;
  minutesTowardFreeze: number;
  /** Day keys that were saved by a freeze. */
  frozenDays: string[];
  /** Commons in a row since the last rare-or-better seed. */
  pityCounter: number;
  /** speciesId -> how many were found */
  discovered: Record<string, number>;
}

export interface GameState {
  schemaVersion: number;
  createdAt: number;
  sessions: SessionRecord[];
  active: ActiveSession | null;
  seeds: Record<string, Seed>;
  world: World;
  economy: Economy;
  progress: Progress;
}

/** Everything the result screen needs after a completed session. */
export interface CompletionSummary {
  session: SessionRecord;
  seed: Seed;
  isNewSpecies: boolean;
  minutes: number;
  coinsEarned: number;
  stake: number;
  payout: number;
  streakBefore: number;
  streakAfter: number;
  qualifiedForStreak: boolean;
  freezeEarned: boolean;
  ringBefore: number;
  ringAfter: number;
  ringClosedNow: boolean;
  vitalityBefore: number;
  vitalityAfter: number;
}

export interface WitherSummary {
  session: SessionRecord;
  reason: WitherReason;
  stakeLost: number;
}

export type Rand = () => number;
