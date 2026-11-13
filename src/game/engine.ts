import { CONFIG } from './config';
import { feedWorld, vitalityNow } from './decay';
import { coinsForSession, maxStake, wagerPayout } from './economy';
import { rollSeed } from './rewards';
import { claimLevels, createNature, levelFor, sanitizeStock } from './nature';
import { makeId } from './rng';
import { rewardFocus, settleIsland, syncLandmarks } from './stakes';
import { earnFreezes, markStreakDay, ringProgress, settleStreak, type StreakSettlement } from './streak';
import { dayIndex, dayKey } from './time';
import type {
  ActiveSession,
  CompletionSummary,
  GameState,
  NewsItem,
  Rand,
  Seed,
  SessionRecord,
  WitherReason,
  WitherSummary,
} from './types';

export const SCHEMA_VERSION = 3;

export function createInitialState(now: number): GameState {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    sessions: [],
    active: null,
    seeds: {},
    world: {
      tiles: {},
      radius: CONFIG.world.startRadius,
      vitality: 1,
      vitalityAt: now,
      graceUntil: null,
      terrain: {},
    },
    economy: { coins: CONFIG.economy.starterCoins, lifetimeFocusMin: 0, lifetimeSessions: 0 },
    progress: {
      dailyGoalMin: CONFIG.ring.defaultGoalMin,
      days: {},
      streak: 0,
      bestStreak: 0,
      lastStreakDay: null,
      freezes: 0,
      minutesTowardFreeze: 0,
      frozenDays: [],
      pityCounter: 0,
      discovered: {},
    },
    nature: createNature(now),
  };
}

function pushSession(sessions: SessionRecord[], record: SessionRecord): SessionRecord[] {
  return [...sessions, record].slice(-CONFIG.historyCap);
}

// ---------------------------------------------------------------------------
// Session state machine
//
//   idle --start--> running --(time is up)--> completed
//                     |  ^
//          app leaves |  | back within the grace period (max 3 times)
//                     v  |
//                    away --(too long / no graces left / killed)--> withered
// ---------------------------------------------------------------------------

export type StartResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: 'alreadyRunning' | 'invalidDuration' | 'invalidStake' };

export function startSession(
  state: GameState,
  durationSec: number,
  stake: number,
  now: number,
  rand: Rand,
): StartResult {
  if (state.active) return { ok: false, reason: 'alreadyRunning' };
  if (!(durationSec > 0)) return { ok: false, reason: 'invalidDuration' };
  if (!Number.isInteger(stake) || stake < 0 || stake > maxStake(durationSec, state.economy.coins)) {
    return { ok: false, reason: 'invalidStake' };
  }
  const active: ActiveSession = {
    id: makeId('s', now, rand),
    startedAt: now,
    durationSec,
    stake,
    leftAt: null,
    gracesUsed: 0,
  };
  return {
    ok: true,
    // The stake leaves the wallet immediately: a killed app cannot keep it.
    state: { ...state, active, economy: { ...state.economy, coins: state.economy.coins - stake } },
  };
}

export function sessionEndsAt(active: ActiveSession): number {
  return active.startedAt + active.durationSec * 1000;
}

/** 0..1 */
export function sessionProgress(active: ActiveSession, now: number): number {
  const p = (now - active.startedAt) / (active.durationSec * 1000);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export function gracesLeft(active: ActiveSession): number {
  return Math.max(0, CONFIG.session.maxGraces - active.gracesUsed);
}

/** The app went to the background. */
export function leaveApp(state: GameState, now: number): GameState {
  if (!state.active || state.active.leftAt != null) return state;
  return { ...state, active: { ...state.active, leftAt: now } };
}

export type Resolution =
  | { kind: 'idle'; state: GameState }
  | { kind: 'running'; state: GameState; graceUsed: boolean }
  | { kind: 'completed'; state: GameState; summary: CompletionSummary }
  | { kind: 'withered'; state: GameState; summary: WitherSummary };

export type ResolveMode =
  /** A timer fired. The app may be in front or still in the background. */
  | 'tick'
  /** The app just came back to the front. */
  | 'return'
  /** The app was started from scratch and found an unfinished session. */
  | 'coldStart';

/**
 * Bring the session up to date with the clock. This single function covers
 * every way time can pass: a timer tick, coming back from the background, and
 * a cold start after the app was killed.
 *
 * Only an actual return can use up a grace. Timers keep firing for a while
 * after the app goes to the background, so a tick must never be mistaken for
 * the player coming back: while away, a tick can only make the sapling wither.
 */
export function resolveSession(state: GameState, now: number, rand: Rand, mode: ResolveMode = 'tick'): Resolution {
  const active = state.active;
  if (!active) return { kind: 'idle', state };

  let current = state;
  let graceUsed = false;

  if (active.leftAt != null) {
    const away = now - active.leftAt;
    const forgivable = away <= CONFIG.session.graceMs && active.gracesUsed < CONFIG.session.maxGraces;
    if (mode === 'coldStart' || !forgivable) {
      return { kind: 'withered', ...witherSession(state, active.leftAt, 'left') };
    }
    // Still away, still within the grace period: nothing is decided yet.
    if (mode === 'tick') return { kind: 'running', state, graceUsed: false };
    graceUsed = true;
    current = { ...state, active: { ...active, leftAt: null, gracesUsed: active.gracesUsed + 1 } };
  } else if (mode === 'coldStart') {
    // The process died while the session was in front (crash, forced stop).
    return { kind: 'withered', ...witherSession(state, now, 'interrupted') };
  }

  if (now >= sessionEndsAt(active)) {
    return { kind: 'completed', ...completeSession(current, now, rand) };
  }
  return { kind: 'running', state: current, graceUsed };
}

export function witherSession(
  state: GameState,
  now: number,
  reason: WitherReason,
): { state: GameState; summary: WitherSummary } {
  const active = state.active;
  if (!active) throw new Error('No active session to wither');
  const record: SessionRecord = {
    id: active.id,
    startedAt: active.startedAt,
    endedAt: Math.max(active.startedAt, now),
    durationSec: active.durationSec,
    outcome: 'withered',
    witherReason: reason,
    stake: active.stake,
    payout: 0,
    coinsEarned: 0,
  };
  return {
    state: { ...state, active: null, sessions: pushSession(state.sessions, record) },
    summary: { session: record, reason, stakeLost: active.stake },
  };
}

export function completeSession(
  input: GameState,
  now: number,
  rand: Rand,
): { state: GameState; summary: CompletionSummary } {
  const active = input.active;
  if (!active) throw new Error('No active session to complete');

  // First account for the time that passed without focus: what it cost is
  // settled before this session starts to repair it.
  const state = settleIsland(input, now).state;

  const minutes = active.durationSec / 60;
  const today = dayIndex(now);
  const todayKey = dayKey(today);
  const qualifies = minutes >= CONFIG.streak.minQualifyingMin;

  // Streak: settle missed days first, then count today.
  const streakSettled = settleStreak(state.progress, today);
  let progress = streakSettled.progress;
  const streakBefore = progress.streak;
  const firstOfDay = qualifies && progress.lastStreakDay !== today;
  if (qualifies) progress = markStreakDay(progress, today);

  // Daily ring.
  const ringBefore = ringProgress(progress, todayKey);
  progress = { ...progress, days: { ...progress.days, [todayKey]: (progress.days[todayKey] ?? 0) + minutes } };
  const ringAfter = ringProgress(progress, todayKey);

  // Freezes are earned by focusing.
  const freeze = earnFreezes(progress, minutes);
  progress = freeze.progress;

  // Seed drop.
  const roll = rollSeed(minutes, progress.pityCounter, progress.discovered, rand);
  const seed: Seed = {
    id: makeId('seed', now, rand),
    speciesId: roll.speciesId,
    rarity: roll.rarity,
    earnedAt: now,
    source: 'session',
    tile: null,
    plantedAt: null,
  };
  const isNewSpecies = !progress.discovered[roll.speciesId];
  progress = {
    ...progress,
    pityCounter: roll.pityCounter,
    discovered: { ...progress.discovered, [roll.speciesId]: (progress.discovered[roll.speciesId] ?? 0) + 1 },
  };

  // Coins and wager.
  const coinsEarned = coinsForSession(active.durationSec);
  const payout = wagerPayout(active.stake);

  // Feed the world.
  const vitalityBefore = vitalityNow(state.world, now);
  const world = feedWorld(state.world, minutes, qualifies, now);

  const record: SessionRecord = {
    id: active.id,
    startedAt: active.startedAt,
    endedAt: now,
    durationSec: active.durationSec,
    outcome: 'completed',
    stake: active.stake,
    payout,
    coinsEarned,
    seedId: seed.id,
  };

  const levelBefore = levelFor(state.economy.lifetimeFocusMin);
  const settled: GameState = {
    ...state,
    active: null,
    sessions: pushSession(state.sessions, record),
    seeds: { ...state.seeds, [seed.id]: seed },
    world,
    progress,
    economy: {
      coins: state.economy.coins + coinsEarned + payout,
      lifetimeFocusMin: state.economy.lifetimeFocusMin + minutes,
      lifetimeSessions: state.economy.lifetimeSessions + 1,
    },
  };
  const claimed = claimLevels(settled);
  const rewarded = rewardFocus(claimed.state, minutes, qualifies, firstOfDay, now, rand);
  const marked = syncLandmarks(rewarded.state, streakSettled.streakLost, now);
  const news: NewsItem[] = [...rewarded.news, ...marked.news];

  return {
    state: marked.state,
    summary: {
      session: record,
      seed,
      isNewSpecies,
      minutes,
      coinsEarned,
      stake: active.stake,
      payout,
      streakBefore,
      streakAfter: progress.streak,
      qualifiedForStreak: qualifies,
      freezeEarned: freeze.earned > 0,
      ringBefore,
      ringAfter,
      ringClosedNow: ringBefore < 1 && ringAfter >= 1,
      vitalityBefore,
      vitalityAfter: vitalityNow(world, now),
      levelBefore,
      levelAfter: levelFor(claimed.state.economy.lifetimeFocusMin),
      granted: claimed.granted,
      news,
    },
  };
}

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

/**
 * Called when the app comes to the front: settles missed streak days and
 * everything the island lost while nobody was looking.
 */
export function openApp(
  state: GameState,
  now: number,
): { state: GameState; settlement: StreakSettlement; news: NewsItem[] } {
  const settlement = settleStreak(state.progress, dayIndex(now));
  const streaked = settlement.progress === state.progress ? state : { ...state, progress: settlement.progress };
  const island = settleIsland(streaked, now);
  const marked = syncLandmarks(island.state, settlement.streakLost, now);
  return { state: marked.state, settlement, news: [...island.news, ...marked.news] };
}

export type PouchResult =
  | { ok: true; state: GameState; seed: Seed; isNewSpecies: boolean }
  | { ok: false; reason: 'notEnoughCoins' };

/** Spend coins on a lucky pouch: a seed that is guaranteed rare or better. */
export function buyPouch(state: GameState, now: number, rand: Rand): PouchResult {
  const cost = CONFIG.economy.pouchCost;
  if (state.economy.coins < cost) return { ok: false, reason: 'notEnoughCoins' };
  const roll = rollSeed(CONFIG.rewards.luckReferenceMin, 0, state.progress.discovered, rand, 'rare');
  const seed: Seed = {
    id: makeId('seed', now, rand),
    speciesId: roll.speciesId,
    rarity: roll.rarity,
    earnedAt: now,
    source: 'pouch',
    tile: null,
    plantedAt: null,
  };
  const isNewSpecies = !state.progress.discovered[roll.speciesId];
  return {
    ok: true,
    seed,
    isNewSpecies,
    state: {
      ...state,
      seeds: { ...state.seeds, [seed.id]: seed },
      economy: { ...state.economy, coins: state.economy.coins - cost },
      progress: {
        ...state.progress,
        discovered: {
          ...state.progress.discovered,
          [roll.speciesId]: (state.progress.discovered[roll.speciesId] ?? 0) + 1,
        },
      },
    },
  };
}

export function setDailyGoal(state: GameState, minutes: number): GameState {
  const { minGoalMin, maxGoalMin } = CONFIG.ring;
  const goal = Math.min(maxGoalMin, Math.max(minGoalMin, Math.round(minutes)));
  return { ...state, progress: { ...state.progress, dailyGoalMin: goal } };
}

/** Bring a persisted state of any older shape up to the current schema. */
export function migrate(raw: unknown, now: number): GameState {
  const fresh = createInitialState(now);
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as Partial<GameState>;
  const state: GameState = {
    ...fresh,
    ...r,
    schemaVersion: SCHEMA_VERSION,
    sessions: Array.isArray(r.sessions) ? r.sessions : [],
    seeds: r.seeds ?? {},
    world: { ...fresh.world, ...(r.world ?? {}), terrain: { ...(r.world?.terrain ?? {}) } },
    economy: { ...fresh.economy, ...(r.economy ?? {}) },
    progress: { ...fresh.progress, ...(r.progress ?? {}) },
    nature: {
      // Saves from before the stakes start with a clean slate: the drought counts from now.
      ...fresh.nature,
      ...(r.nature ?? {}),
      stock: sanitizeStock(r.nature?.stock),
      levelClaimed: r.nature?.levelClaimed ?? 1,
      discovered: { ...(r.nature?.discovered ?? {}) },
      bonds: { ...(r.nature?.bonds ?? {}) },
      spared: { ...(r.nature?.spared ?? {}) },
      away: { ...(r.nature?.away ?? {}) },
      family: { ...(r.nature?.family ?? {}) },
      landmarks: { ...(r.nature?.landmarks ?? {}) },
      news: Array.isArray(r.nature?.news) ? r.nature.news : [],
    },
  };
  // Saves from before the living island get the rewards of every level they
  // already reached, and a running streak builds the landmarks it has earned.
  return syncLandmarks(claimLevels(state).state, 0, now).state;
}
