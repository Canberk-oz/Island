import { CONFIG, HOUR_MS } from './config';
import { clamp01, hash01 } from './rng';
import type { Rarity, World } from './types';

/**
 * Vitality of the world at `now`.
 *
 * Nothing runs in the background: vitality is stored together with the moment
 * it was measured, and the fading since then is computed on demand. That makes
 * "the app was closed for days" exactly the same case as "a second passed".
 *
 *   fading starts at  max(vitalityAt, graceUntil)
 *   vitality(now)   = stored - hoursOfFading / hoursToEmpty      (clamped 0..1)
 *
 * Vitality never drops below 0, so a month away costs the same as four days:
 * there is no debt and nothing ever dies.
 */
export function vitalityNow(world: World, now: number): number {
  if (world.graceUntil == null) return clamp01(world.vitality);
  const fadingFrom = Math.max(world.vitalityAt, world.graceUntil);
  // A clock that was set backwards yields a negative span: treat it as zero.
  const hours = Math.max(0, now - fadingFrom) / HOUR_MS;
  return clamp01(world.vitality - hours / CONFIG.decay.hoursToEmpty);
}

/**
 * Feed the world with focus minutes. A qualifying session (long enough to
 * count for the streak) also restarts the grace window.
 */
export function feedWorld(world: World, minutes: number, qualifies: boolean, now: number): World {
  const current = vitalityNow(world, now);
  const vitality = clamp01(current + Math.max(0, minutes) / CONFIG.decay.minutesToFull);
  let graceUntil = world.graceUntil;
  if (qualifies) graceUntil = now + CONFIG.decay.graceHours * HOUR_MS;
  else if (graceUntil == null) graceUntil = now;
  return { ...world, vitality, vitalityAt: now, graceUntil };
}

/** Hours until fading starts (0 when it already has). */
export function hoursUntilFading(world: World, now: number): number {
  if (world.graceUntil == null) return Infinity;
  return Math.max(0, world.graceUntil - now) / HOUR_MS;
}

/** Focus minutes needed to bring the world back to full vitality. */
export function minutesToFullVitality(world: World, now: number): number {
  return Math.ceil((1 - vitalityNow(world, now)) * CONFIG.decay.minutesToFull - 1e-9);
}

export type VitalityMood = 'thriving' | 'thirsty' | 'wilting' | 'dormant';

export function moodOf(vitality: number): VitalityMood {
  if (vitality >= 0.85) return 'thriving';
  if (vitality >= 0.5) return 'thirsty';
  if (vitality >= 0.12) return 'wilting';
  return 'dormant';
}

const RARITY_RESILIENCE: Record<Rarity, number> = { common: 0, rare: 0.06, epic: 0.12, legendary: 0.25 };

/**
 * The vitality level below which a given plant starts to wilt. Plants at the
 * edge of the island go first, the centre and the rarest plants hold out
 * longest, so the island droops plant by plant instead of all at once.
 */
export function wiltThreshold(tileKey: string, radius: number, rarity: Rarity): number {
  const [x, y] = tileKey.split(',').map(Number);
  const edge = clamp01(Math.sqrt(x * x + y * y) / (radius + 0.5));
  const u = clamp01(0.6 * edge + 0.4 * hash01(tileKey) - RARITY_RESILIENCE[rarity]);
  return 0.2 + 0.78 * u;
}

/** 0 = fresh, 1 = fully wilted. */
export function wiltAmount(threshold: number, vitality: number): number {
  return clamp01((threshold - vitality) / CONFIG.decay.wiltBand);
}
