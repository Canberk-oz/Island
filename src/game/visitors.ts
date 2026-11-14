import { habitatOf, type Habitat, type Resident } from './nature';
import { hashString } from './rng';
import { dayIndex } from './time';
import type { GameState } from './types';

/**
 * Daily visitors: travelling animals that do not live on the island. Each
 * day one of them is passing by, and it only lands if you focus that day
 * (one session of 10+ minutes). It stays until the day is over.
 */

export interface VisitorDef {
  id: string;
  name: string;
  blurb: string;
  /** How often it is the one passing by. */
  weight: number;
  /** The resident it moves like (decides where it walks, swims or flies). */
  like: 'deer' | 'rabbit' | 'fox' | 'duck' | 'bird' | 'wader';
  /** What the island must offer for it to stop. */
  suits: (h: Habitat) => boolean;
  /** Shown before it has ever been met. */
  hint: string;
  sound: string;
}

export const VISITORS: readonly VisitorDef[] = [
  { id: 'snowhare', name: 'Snow Hare', blurb: 'White all year, and proud of it.', weight: 3, like: 'rabbit', suits: (h) => h.plants >= 3, hint: 'Stops on any island with a few plants', sound: 'squeak' },
  { id: 'stag', name: 'Great Stag', blurb: 'Crosses the island as if he owned it.', weight: 3, like: 'deer', suits: (h) => h.trees >= 2, hint: 'Looks for an island with trees', sound: 'snort' },
  { id: 'heron', name: 'Grey Heron', blurb: 'Stands at the water for hours. Then, suddenly, not.', weight: 2, like: 'wader', suits: (h) => h.water >= 1, hint: 'Looks for water to stand by', sound: 'splash' },
  { id: 'swan', name: 'Swan', blurb: 'Glides in, looks around, approves.', weight: 2, like: 'duck', suits: (h) => h.biggestWater >= 2, hint: 'Needs water to swim on', sound: 'quack' },
  { id: 'kingfisher', name: 'Kingfisher', blurb: 'A blue spark between tree and water.', weight: 2, like: 'bird', suits: (h) => h.trees >= 1 && h.water >= 1, hint: 'Wants a tree near water', sound: 'chirp' },
  { id: 'peacock', name: 'Peacock', blurb: 'Came to be looked at.', weight: 1, like: 'fox', suits: (h) => h.plants >= 8, hint: 'Only visits a well-planted island', sound: 'yip' },
];

const BY_ID: Record<string, VisitorDef> = Object.fromEntries(VISITORS.map((v) => [v.id, v]));

export function getVisitor(id: string | null | undefined): VisitorDef | undefined {
  return id ? BY_ID[id] : undefined;
}

/** Who is passing by on a given day (null when the island has nothing to offer anyone). */
export function visitorPassing(state: GameState, day: number): string | null {
  const h = habitatOf(state.world, state.seeds);
  const pool = VISITORS.filter((v) => v.suits(h));
  const total = pool.reduce((sum, v) => sum + v.weight, 0);
  if (total === 0) return null;
  let pick = hashString(`visitor${day}`) % total;
  for (const v of pool) {
    if (pick < v.weight) return v.id;
    pick -= v.weight;
  }
  return null;
}

/** The visitor that is on the island right now (it landed because you focused today). */
export function visitorHere(state: GameState, now: number): string | null {
  const v = state.nature.visitor;
  return v && v.day === dayIndex(now) ? v.id : null;
}

/** The visitor that would land if you focused today (null once it has, or when nobody is passing). */
export function visitorWaiting(state: GameState, now: number): string | null {
  if (visitorHere(state, now)) return null;
  return visitorPassing(state, dayIndex(now));
}

/** The visitor as one more animal for the island scene. */
export function visitorResident(state: GameState, now: number): Resident[] {
  const id = visitorHere(state, now);
  return id ? [{ id, count: 1, present: true, young: false, dry: false }] : [];
}
