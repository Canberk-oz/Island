import type { Rarity } from './types';

/**
 * Every tunable number of the game lives here, so balance changes never
 * require touching logic or UI code.
 */
export const CONFIG = {
  /** A "day" rolls over at 04:00 local time, so late-night focus counts for the same day. */
  dayRolloverHour: 4,

  session: {
    /** How long the app may stay in the background before the sapling withers. */
    graceMs: 6000,
    /** How many times per session a short absence is forgiven. */
    maxGraces: 3,
    /** Growth milestones (fraction of the session) where a leaf pair pops. */
    milestones: [0.2, 0.4, 0.6, 0.8] as readonly number[],
  },

  decay: {
    /** Hours after a qualifying session during which nothing fades. */
    graceHours: 20,
    /** Hours of fading from full vitality to fully wilted. */
    hoursToEmpty: 72,
    /** Focus minutes that restore a fully wilted world to full vitality. */
    minutesToFull: 75,
    /** Width of the vitality band over which a single plant goes from fresh to wilted. */
    wiltBand: 0.18,
  },

  streak: {
    /** Minimum session length that counts for the streak and resets the decay grace. */
    minQualifyingMin: 10,
    minutesPerFreeze: 120,
    maxFreezes: 2,
  },

  economy: {
    coinsPerMinute: 1,
    starterCoins: 20,
    /** Maximum stake per minute of session length. */
    stakePerMinute: 2,
    wagerMultiplier: 1.5,
    /** Price of a lucky pouch (a guaranteed rare-or-better seed). */
    pouchCost: 100,
  },

  rewards: {
    weights: { common: 70, rare: 22, epic: 7, legendary: 1 } as Record<Rarity, number>,
    /** After this many commons in a row, the next seed is rare or better. */
    pityAfter: 7,
    /** Session length (minutes) at which luck is exactly 1. */
    luckReferenceMin: 25,
    luckMin: 0.25,
    luckMax: 2.5,
    /** Species never found before are this much more likely within their rarity. */
    undiscoveredBias: 2,
  },

  world: {
    startRadius: 1,
    maxRadius: 4,
    /** The island grows once this fraction of its tiles is planted. */
    expandAtFill: 0.7,
  },

  ring: {
    defaultGoalMin: 60,
    minGoalMin: 15,
    maxGoalMin: 240,
    goalStepMin: 15,
  },

  /** Session history kept on device. */
  historyCap: 400,
} as const;

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
