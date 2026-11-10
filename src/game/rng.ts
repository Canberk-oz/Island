import type { Rand } from './types';

/** Small, fast, seedable PRNG. Used for tests and for deterministic visuals. */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable pseudo-random number in [0, 1) derived from a string. */
export function hash01(s: string): number {
  return mulberry32(hashString(s))();
}

export function pickWeighted<T>(items: readonly T[], weights: readonly number[], rand: Rand): T {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  let roll = rand() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= Math.max(0, weights[i]);
    if (roll < 0) return items[i];
  }
  return items[items.length - 1];
}

export function makeId(prefix: string, now: number, rand: Rand): string {
  return `${prefix}_${now.toString(36)}_${Math.floor(rand() * 0xffffff).toString(36)}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
