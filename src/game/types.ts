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
  /** A rare quirk the plant was born with (see variants.ts). */
  variant?: string | null;
  /** Set when the plant died of neglect: it stands as a stump until it is revived or cleared. */
  diedAt?: number | null;
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
  /** tile key "x,y" -> nature piece placed on it (water, rock, ...). */
  terrain: Record<string, TerrainKind>;
}

export type LandmarkKind = 'arch' | 'windmill' | 'lighthouse';
export type TerrainKind = 'water' | 'rock' | 'log' | 'hive' | 'campfire' | LandmarkKind;

export const LANDMARK_KINDS: readonly LandmarkKind[] = ['arch', 'windmill', 'lighthouse'];
export const TERRAIN_KINDS: readonly TerrainKind[] = ['water', 'rock', 'log', 'hive', 'campfire', ...LANDMARK_KINDS];

/** How well an animal knows you. */
export interface Bond {
  /** Grows by one on every day you focus while the animal is out, shrinks while it hides. */
  points: number;
  /** Given once the animal becomes a friend. It keeps the name even if it leaves. */
  name: string | null;
}

/** An animal that moved away after a long drought. */
export interface Away {
  leftAt: number;
  /** Focus days collected toward its return. */
  days: number;
}

export type NewsKind =
  | 'left'
  | 'returned'
  | 'died'
  | 'revived'
  | 'born'
  | 'befriended'
  | 'visited'
  | 'landmark'
  | 'ruined'
  | 'rebuilt'
  | 'questStarted'
  | 'questDone'
  | 'questFailed';

/** One line of the island diary. */
export interface NewsItem {
  at: number;
  kind: NewsKind;
  /** Animal id, species id or landmark kind, depending on the kind. */
  subject: string;
  /** The animal's name, when it has one. */
  name?: string | null;
  /** How many (plants that died or were revived at once). */
  count?: number;
}

/** The comeback quest: focus on three days to win back half of what was lost. */
export interface Revival {
  startDay: number;
  /** Focus days done so far. */
  days: number;
}

export interface Nature {
  /** Nature pieces waiting to be placed. */
  stock: Record<TerrainKind, number>;
  /** Highest island level whose rewards were handed out. */
  levelClaimed: number;
  /** animal id -> when it first moved in */
  discovered: Record<string, number>;
  /**
   * Hours the island has spent completely wilted, minus what focus has paid
   * back. This is the damage meter: animals leave and plants die as it grows.
   */
  drought: number;
  /**
   * Fresh starts: animal id or seed id -> the drought level at which it came
   * back. Its limit counts from there, so nothing that was just won back is
   * lost again a moment later. Cleared when the drought is fully paid off.
   */
  spared: Record<string, number>;
  /** Moment up to which `drought` and the bonds are accounted for. */
  settledAt: number;
  bonds: Record<string, Bond>;
  /** animal id -> it moved away */
  away: Record<string, Away>;
  /** animal id -> when its young was born */
  family: Record<string, number>;
  lastBirthDay: number | null;
  /** Streak landmarks that were earned, and whether a lost streak left them in ruins. */
  landmarks: Partial<Record<LandmarkKind, { earnedAt: number; ruined: boolean }>>;
  revival: Revival | null;
  /** Island diary, oldest first. */
  news: NewsItem[];
  /** The travelling animal that landed today, and how often each one has been met. */
  visitor: { id: string; day: number } | null;
  visitors: Record<string, number>;
  /** Diary entries after this moment have not been shown yet. */
  newsSeenAt: number;
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
  /** variant id -> how many were found */
  variants: Record<string, number>;
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
  nature: Nature;
}

/** Everything the result screen needs after a completed session. */
export interface CompletionSummary {
  session: SessionRecord;
  /** Null when the session was too short to drop a seed. */
  seed: Seed | null;
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
  levelBefore: number;
  levelAfter: number;
  /** Nature pieces handed out by the level-ups of this session. */
  granted: Partial<Record<TerrainKind, number>>;
  /** What this session changed on the island (returns, revivals, births, ...). */
  news: NewsItem[];
}

export interface WitherSummary {
  session: SessionRecord;
  reason: WitherReason;
  stakeLost: number;
}

export type Rand = () => number;
