import { CONFIG } from './config';
import type { GameState, World } from './types';

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseTile(key: string): { x: number; y: number } {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

/** The island is a rounded blob of grid tiles around the origin. */
export function isTileInRadius(x: number, y: number, radius: number): boolean {
  return x * x + y * y <= (radius + 0.5) * (radius + 0.5);
}

/** All tiles of an island of the given radius, sorted back to front for drawing. */
export function tilesInRadius(radius: number): { x: number; y: number; key: string }[] {
  const out: { x: number; y: number; key: string }[] = [];
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (isTileInRadius(x, y, radius)) out.push({ x, y, key: tileKey(x, y) });
    }
  }
  return out.sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
}

export function tileCount(radius: number): number {
  return tilesInRadius(radius).length;
}

export function plantedCount(world: World): number {
  return Object.keys(world.tiles).length;
}

/** Plants still needed before the island grows (0 at the maximum size). */
export function plantsUntilExpansion(world: World): number {
  if (world.radius >= CONFIG.world.maxRadius) return 0;
  const needed = Math.ceil(tileCount(world.radius) * CONFIG.world.expandAtFill);
  return Math.max(0, needed - plantedCount(world));
}

function expandIfReady(world: World): World {
  let next = world;
  while (next.radius < CONFIG.world.maxRadius && plantsUntilExpansion(next) === 0) {
    next = { ...next, radius: next.radius + 1 };
  }
  return next;
}

export type PlantResult =
  | { ok: true; state: GameState; islandGrew: boolean }
  | { ok: false; reason: 'unknownSeed' | 'alreadyPlanted' | 'outOfBounds' | 'occupied' };

export function plantSeed(state: GameState, seedId: string, x: number, y: number, now: number): PlantResult {
  const seed = state.seeds[seedId];
  if (!seed) return { ok: false, reason: 'unknownSeed' };
  if (seed.tile != null) return { ok: false, reason: 'alreadyPlanted' };
  if (!isTileInRadius(x, y, state.world.radius)) return { ok: false, reason: 'outOfBounds' };
  const key = tileKey(x, y);
  if (state.world.tiles[key]) return { ok: false, reason: 'occupied' };

  const planted = { ...state.world, tiles: { ...state.world.tiles, [key]: seedId } };
  const world = expandIfReady(planted);
  return {
    ok: true,
    islandGrew: world.radius > state.world.radius,
    state: {
      ...state,
      world,
      seeds: { ...state.seeds, [seedId]: { ...seed, tile: key, plantedAt: now } },
    },
  };
}

/** Dig a plant up and put its seed back in the tray. The island never shrinks. */
export function digUp(state: GameState, x: number, y: number): GameState {
  const key = tileKey(x, y);
  const seedId = state.world.tiles[key];
  if (!seedId) return state;
  const tiles = { ...state.world.tiles };
  delete tiles[key];
  const seed = state.seeds[seedId];
  return {
    ...state,
    world: { ...state.world, tiles },
    seeds: seed ? { ...state.seeds, [seedId]: { ...seed, tile: null, plantedAt: null } } : state.seeds,
  };
}

/** Seeds waiting in the tray, newest first. */
export function unplantedSeeds(state: GameState) {
  return Object.values(state.seeds)
    .filter((s) => s.tile == null)
    .sort((a, b) => b.earnedAt - a.earnedAt);
}
