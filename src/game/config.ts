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
    maxRadius: 5,
    /** The island grows once this fraction of its tiles is planted. */
    expandAtFill: 0.7,
    /** A plant grows up where it stands: sprout, young (after a day), mature (4 days), ancient (30 days). */
    growthAfterHours: [0, 24, 96, 720] as readonly number[],
    growthScale: [0.62, 0.82, 1, 1.14] as readonly number[],
  },

  ring: {
    defaultGoalMin: 60,
    minGoalMin: 15,
    maxGoalMin: 240,
    goalStepMin: 15,
  },

  /**
   * What neglect costs. Everything here is driven by the drought meter: the
   * hours the island has spent at zero vitality, minus one hour per focused
   * minute. A full island takes 20 h + 72 h to reach zero, so the first
   * permanent loss is about five and a half days of no focus at all.
   */
  stakes: {
    /** The meter stops here: neglect never becomes a debt of more than six hours of focus. */
    maxDroughtHours: 360,
    /** Drought hours each focused minute pays back. */
    droughtPaidPerMinute: 1,
    /** Drought hours after which the shyest animal (shy 0.65) leaves. */
    leaveAfterHours: 36,
    /** Extra hours per 0.1 of hardiness: the boldest animal (shy 0.25) stays 108 h longer. */
    leaveHoursPerHardiness: 27,
    /** Every bond level makes an animal wait this much longer before leaving. */
    leaveHoursPerBondLevel: 12,
    /** A family with young does not wait: it leaves after this many hours. */
    familyLeavesAfterHours: 24,
    /** Focus days an animal needs before it moves back in. */
    returnDays: 5,
    /** Bond points lost per day an animal spends hiding. */
    bondLossPerHiddenDay: 1,
    /** Bond points at which each level starts: stranger, familiar, friend, companion, family. */
    bondLevels: [0, 3, 7, 14, 30] as readonly number[],
    maxBond: 40,
    /** Streak needed before animals have young, and the bond level the parents need. */
    youngAtStreak: 7,
    youngAtBondLevel: 2,
    /** Days between two births on the island, and days until a young one is grown. */
    daysBetweenBirths: 3,
    youngGrowsInDays: 10,
    /** Drought hours after which the first common plant dies; the rest follow over `plantDeathSpreadHours`. */
    plantDiesAfterHours: 60,
    plantDeathSpreadHours: 96,
    plantDeathExtraHours: { common: 0, rare: 36, epic: 72, legendary: 192 } as Record<Rarity, number>,
    /** Coins to bring a stump back to life right away. */
    reviveCost: { common: 15, rare: 30, epic: 60, legendary: 120 } as Record<Rarity, number>,
    /** Water is gone after this many drought hours. */
    waterDryHours: 48,
    /** Below this vitality the water already starts to sink. */
    waterLowBelow: 0.2,
    /** A withered session leaves a dead twig on the island for this long. */
    scarHours: 24,
    /** Comeback quest: focus days needed, and the days you have for them. */
    revivalDays: 3,
    revivalWindowDays: 5,
    /** Streak lengths that build a landmark. A ruined one is rebuilt at this fraction of its streak. */
    landmarkStreaks: { arch: 7, windmill: 30, lighthouse: 100 },
    landmarkRebuildFraction: 0.5,
    /** Diary entries kept. */
    newsCap: 60,
  },

  /** Session history kept on device. */
  historyCap: 400,
} as const;

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
