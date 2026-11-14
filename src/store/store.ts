import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  buyPouch,
  createInitialState,
  leaveApp,
  migrate,
  openApp,
  resolveSession,
  setDailyGoal,
  startSession,
  witherSession,
  type ResolveMode,
} from '../game/engine';
import type { CompletionSummary, GameState, Seed, WitherSummary } from '../game/types';
import { claimLevels, discoverWildlife, placeTerrain, removeTerrain } from '../game/nature';
import { vitalityNow } from '../game/decay';
import { residentContext, revivePlant, syncLandmarks } from '../game/stakes';
import { dayIndex } from '../game/time';
import type { TerrainKind } from '../game/types';
import type { Season, Weather } from '../game/atmosphere';
import { digUp, growIsland, plantSeed } from '../game/world';

const STORAGE_KEY = 'grove/save/v1';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  notifications: boolean;
  devTools: boolean;
  /** Developer time travel: added to the real clock everywhere. */
  timeOffsetMs: number;
  lastDurationMin: number;
  /** Vitality the island showed last time it was on screen (drives the fade / revive animation). */
  lastSeenVitality: number;
  onboarded: boolean;
  /** Seasons follow the southern hemisphere. */
  south: boolean;
  /** Play the island's soundscape quietly during a session. */
  focusAmbience: boolean;
  /** Island level the player last saw on the island (drives the level-up moment). */
  lastSeenLevel: number;
  /** Developer: force a season or a kind of weather. */
  seasonOverride: Season | null;
  weatherOverride: Weather | null;
}

const DEFAULT_SETTINGS: Settings = {
  sound: true,
  haptics: true,
  notifications: true,
  devTools: false,
  timeOffsetMs: 0,
  lastDurationMin: 25,
  lastSeenVitality: 1,
  onboarded: false,
  south: false,
  focusAmbience: true,
  lastSeenLevel: 0,
  seasonOverride: null,
  weatherOverride: null,
};

export type SessionResult =
  | { kind: 'completed'; summary: CompletionSummary }
  | { kind: 'withered'; summary: WitherSummary };

export interface Notice {
  id: number;
  tone: 'good' | 'warn' | 'info';
  text: string;
}

interface Store {
  hydrated: boolean;
  game: GameState;
  settings: Settings;
  /** Result of the session that just ended, shown until dismissed. Not persisted. */
  result: SessionResult | null;
  notice: Notice | null;
  /** A full-screen moment is on top (hides the tab bar). Not persisted. */
  immersive: boolean;
  setImmersive: (v: boolean) => void;

  now: () => number;
  hydrate: () => Promise<void>;
  start: (durationSec: number, stake: number) => boolean;
  /** Advance the session with the clock. Returns what happened. */
  tick: () => 'idle' | 'running' | 'grace' | 'completed' | 'withered';
  background: () => void;
  foreground: () => 'idle' | 'running' | 'grace' | 'completed' | 'withered';
  giveUp: () => void;
  dismissResult: () => void;
  plant: (seedId: string, x: number, y: number) => { ok: boolean; islandGrew: boolean };
  dig: (x: number, y: number) => void;
  /** Place a nature piece from the stock on a tile. */
  placeNature: (kind: TerrainKind, x: number, y: number) => { ok: boolean; islandGrew: boolean };
  /** Pay coins to bring the stump on a tile back to life. */
  revive: (x: number, y: number) => { ok: boolean; cost: number };
  /** Bring streak and island up to date with the clock (also done whenever the app comes to the front). */
  refresh: () => void;
  /** The island diary was shown: nothing in it is new any more. */
  markNewsSeen: () => void;
  /** Pick a nature piece back up. */
  liftNature: (x: number, y: number) => void;
  /** Note animals that moved in for the first time. Returns their ids. */
  discover: (night: boolean) => string[];
  pouch: () => { seed: Seed; isNewSpecies: boolean } | null;
  setGoal: (minutes: number) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  notify: (tone: Notice['tone'], text: string) => void;
  clearNotice: () => void;
  devAddCoins: (amount: number) => void;
  /** Developer: add lifetime focus minutes (raises the island level). */
  devAddFocus: (minutes: number) => void;
  devSkipTime: (hours: number) => void;
  /** Developer: lengthen the streak (builds landmarks, lets animals have young). */
  devAddStreak: (days: number) => void;
  resetAll: () => void;
}

let noticeId = 1;

/**
 * One line per session event in the device log (`adb logcat -s ReactNativeJS`).
 * It makes the leave / grace / wither logic observable on a real phone and is
 * what the automated emulator test asserts on.
 */
function log(event: string, detail = '') {
  console.log(`[grove] ${event}${detail ? ` ${detail}` : ''}`);
}

export const useStore = create<Store>((set, get) => {
  const now = () => Date.now() + get().settings.timeOffsetMs;

  /** Apply the outcome of `resolveSession` and report it. */
  const resolve = (mode: ResolveMode) => {
    const res = resolveSession(get().game, now(), Math.random, mode);
    switch (res.kind) {
      case 'idle':
        return 'idle' as const;
      case 'running':
        if (res.state !== get().game) set({ game: res.state });
        if (res.graceUsed) log('session:grace', `used=${res.state.active?.gracesUsed}`);
        return res.graceUsed ? ('grace' as const) : ('running' as const);
      case 'completed':
        set({ game: res.state, result: { kind: 'completed', summary: res.summary } });
        log('session:completed', `seed=${res.summary.seed.speciesId} rarity=${res.summary.seed.rarity}`);
        for (const n of res.summary.news) log(`island:${n.kind}`, n.subject);
        return 'completed' as const;
      case 'withered':
        set({ game: res.state, result: { kind: 'withered', summary: res.summary } });
        log('session:withered', `reason=${res.summary.reason} via=${mode}`);
        return 'withered' as const;
    }
  };

  /** Settle missed streak days and tell the player what happened. */
  const settle = () => {
    const { state, settlement, news } = openApp(get().game, now());
    if (state !== get().game) set({ game: state });
    for (const n of news) log(`island:${n.kind}`, `${n.subject}${n.count ? ` x${n.count}` : ''}`);
    if (settlement.freezesUsed > 0) {
      const n = settlement.freezesUsed;
      get().notify('info', `${n === 1 ? 'A freeze' : `${n} freezes`} kept your ${state.progress.streak}-day streak safe.`);
    } else if (settlement.streakLost > 0) {
      get().notify('warn', `Your ${settlement.streakLost}-day streak ended. A new one starts today.`);
    }
  };

  return {
    hydrated: false,
    game: createInitialState(Date.now()),
    settings: DEFAULT_SETTINGS,
    result: null,
    notice: null,
    immersive: false,
    setImmersive: (v) => set({ immersive: v }),

    now,

    hydrate: async () => {
      let game = createInitialState(Date.now());
      let settings = DEFAULT_SETTINGS;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) };
          game = migrate(parsed.game, Date.now() + settings.timeOffsetMs);
        }
      } catch {
        // A corrupt save falls back to a fresh world rather than a crash.
      }
      set({ game, settings });
      // A session that was running when the app died is resolved before anything is shown.
      resolve('coldStart');
      settle();
      set({ hydrated: true });
      log('app:ready', `sessions=${get().game.sessions.length} plants=${Object.keys(get().game.world.tiles).length}`);
    },

    start: (durationSec, stake) => {
      const res = startSession(get().game, durationSec, stake, now(), Math.random);
      if (!res.ok) return false;
      set({ game: res.state, result: null });
      log('session:start', `seconds=${durationSec} stake=${stake}`);
      return true;
    },

    tick: () => resolve('tick'),

    background: () => {
      const next = leaveApp(get().game, now());
      if (next !== get().game) {
        set({ game: next });
        log('session:left');
      }
    },

    foreground: () => {
      const outcome = resolve('return');
      settle();
      return outcome;
    },

    giveUp: () => {
      const game = get().game;
      if (!game.active) return;
      const res = witherSession(game, now(), 'gaveUp');
      set({ game: res.state, result: { kind: 'withered', summary: res.summary } });
      log('session:withered', 'reason=gaveUp via=hold');
    },

    dismissResult: () => set({ result: null }),

    plant: (seedId, x, y) => {
      const res = plantSeed(get().game, seedId, x, y, now());
      if (!res.ok) return { ok: false, islandGrew: false };
      set({ game: res.state });
      log('island:planted', `tile=${x},${y} plants=${Object.keys(res.state.world.tiles).length}`);
      return { ok: true, islandGrew: res.islandGrew };
    },

    dig: (x, y) => set({ game: digUp(get().game, x, y) }),

    revive: (x, y) => {
      const res = revivePlant(get().game, `${x},${y}`, now());
      if (!res.ok) return { ok: false, cost: res.cost };
      set({ game: res.state });
      log('island:revived', `tile=${x},${y}`);
      return { ok: true, cost: res.cost };
    },

    refresh: () => settle(),

    markNewsSeen: () => {
      const game = get().game;
      const last = game.nature.news[game.nature.news.length - 1];
      if (!last || last.at <= game.nature.newsSeenAt) return;
      set({ game: { ...game, nature: { ...game.nature, newsSeenAt: Math.max(now(), last.at) } } });
    },

    placeNature: (kind, x, y) => {
      const res = placeTerrain(get().game, kind, x, y, growIsland);
      if (!res.ok) return { ok: false, islandGrew: false };
      set({ game: res.state });
      log('island:placed', `${kind} tile=${x},${y}`);
      return { ok: true, islandGrew: res.islandGrew };
    },

    liftNature: (x, y) => set({ game: removeTerrain(get().game, x, y) }),

    discover: (night) => {
      const game = get().game;
      const res = discoverWildlife(game, vitalityNow(game.world, now()), now(), night, residentContext(game, now()));
      if (res.arrived.length === 0) return [];
      set({ game: res.state });
      log('island:arrived', res.arrived.join(','));
      return res.arrived;
    },

    pouch: () => {
      const res = buyPouch(get().game, now(), Math.random);
      if (!res.ok) return null;
      set({ game: res.state });
      return { seed: res.seed, isNewSpecies: res.isNewSpecies };
    },

    setGoal: (minutes) => set({ game: setDailyGoal(get().game, minutes) }),

    updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),

    notify: (tone, text) => set({ notice: { id: noticeId++, tone, text } }),
    clearNotice: () => set({ notice: null }),

    devAddFocus: (minutes) => {
      const game = get().game;
      const next = { ...game, economy: { ...game.economy, lifetimeFocusMin: game.economy.lifetimeFocusMin + minutes } };
      set({ game: claimLevels(next).state });
    },

    devAddCoins: (amount) => {
      const game = get().game;
      set({ game: { ...game, economy: { ...game.economy, coins: game.economy.coins + amount } } });
    },

    devSkipTime: (hours) => {
      const s = get().settings;
      set({ settings: { ...s, timeOffsetMs: s.timeOffsetMs + hours * 3_600_000 } });
      settle();
    },

    devAddStreak: (days) => {
      const game = get().game;
      const streak = game.progress.streak + days;
      const progress = { ...game.progress, streak, bestStreak: Math.max(game.progress.bestStreak, streak), lastStreakDay: dayIndex(now()) };
      set({ game: syncLandmarks({ ...game, progress }, 0, now()).state });
    },

    resetAll: () => {
      set({ game: createInitialState(Date.now()), settings: { ...DEFAULT_SETTINGS, onboarded: true }, result: null });
    },
  };
});

// Persist the game and the settings whenever either changes. Writes are
// serialised so a slow write can never overwrite a newer one.
let writing = false;
let dirty = false;

async function flush() {
  if (writing) {
    dirty = true;
    return;
  }
  writing = true;
  try {
    do {
      dirty = false;
      const { game, settings } = useStore.getState();
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ game, settings }));
    } while (dirty);
  } catch {
    // Storage is best effort; the in-memory state stays authoritative.
  } finally {
    writing = false;
  }
}

useStore.subscribe((state, prev) => {
  if (!state.hydrated) return;
  if (state.game !== prev.game || state.settings !== prev.settings || !prev.hydrated) void flush();
});
