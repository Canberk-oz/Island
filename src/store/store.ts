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
import { digUp, plantSeed } from '../game/world';

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
  pouch: () => { seed: Seed; isNewSpecies: boolean } | null;
  setGoal: (minutes: number) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  notify: (tone: Notice['tone'], text: string) => void;
  clearNotice: () => void;
  devAddCoins: (amount: number) => void;
  devSkipTime: (hours: number) => void;
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
        return 'completed' as const;
      case 'withered':
        set({ game: res.state, result: { kind: 'withered', summary: res.summary } });
        log('session:withered', `reason=${res.summary.reason} via=${mode}`);
        return 'withered' as const;
    }
  };

  /** Settle missed streak days and tell the player what happened. */
  const settle = () => {
    const { state, settlement } = openApp(get().game, now());
    if (state !== get().game) set({ game: state });
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

    devAddCoins: (amount) => {
      const game = get().game;
      set({ game: { ...game, economy: { ...game.economy, coins: game.economy.coins + amount } } });
    },

    devSkipTime: (hours) => {
      const s = get().settings;
      set({ settings: { ...s, timeOffsetMs: s.timeOffsetMs + hours * 3_600_000 } });
      settle();
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
