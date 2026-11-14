import { CONFIG } from './config';
import { clamp, pickWeighted } from './rng';
import { speciesOfRarity } from './species';
import { RARITIES, type Rand, type Rarity } from './types';

/** Longer sessions are luckier. 25 minutes is the reference (luck = 1). */
export function luckFor(minutes: number): number {
  const r = CONFIG.rewards;
  return clamp(minutes / r.luckReferenceMin, r.luckMin, r.luckMax);
}

/** Chance of each rarity for a session of the given length, summing to 1. */
export function rarityOdds(minutes: number, pityCounter = 0, minRarity: Rarity = 'common'): Record<Rarity, number> {
  const luck = luckFor(minutes);
  const base = CONFIG.rewards.weights;
  const guaranteed = pityCounter >= CONFIG.rewards.pityAfter;
  const minIndex = Math.max(RARITIES.indexOf(minRarity), guaranteed ? 1 : 0);
  const weights = RARITIES.map((r, i) => {
    if (i < minIndex) return 0;
    return r === 'common' ? base.common : base[r] * luck;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  return Object.fromEntries(RARITIES.map((r, i) => [r, weights[i] / total])) as Record<Rarity, number>;
}

export interface SeedRoll {
  rarity: Rarity;
  speciesId: string;
  pityCounter: number;
}

/**
 * Roll the seed for a completed session.
 * - longer sessions shift the odds toward rarer seeds
 * - after `pityAfter` commons in a row the next seed is rare or better
 * - species that were never found before are favoured within their rarity
 */
export function rollSeed(
  minutes: number,
  pityCounter: number,
  discovered: Record<string, number>,
  rand: Rand,
  minRarity: Rarity = 'common',
): SeedRoll {
  const odds = rarityOdds(minutes, pityCounter, minRarity);
  const rarity = pickWeighted(RARITIES, RARITIES.map((r) => odds[r]), rand);
  const pool = speciesOfRarity(rarity);
  const species = pickWeighted(
    pool,
    pool.map((s) => (discovered[s.id] ? 1 : CONFIG.rewards.undiscoveredBias)),
    rand,
  );
  return {
    rarity,
    speciesId: species.id,
    pityCounter: rarity === 'common' ? pityCounter + 1 : 0,
  };
}
