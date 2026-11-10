import { getSpecies, type PlantKind } from './species';
import type { GameState, Nature, Seed, TerrainKind, World } from './types';
import { TERRAIN_KINDS } from './types';
import { isTileInRadius, parseTile, tileKey } from './world';

// ---------------------------------------------------------------------------
// Island levels: lifetime focus turns into nature pieces to place.
// ---------------------------------------------------------------------------

export interface LevelDef {
  /** Lifetime focus minutes needed to reach this level. */
  minutes: number;
  grants: Partial<Record<TerrainKind, number>>;
}

/** Level n (1-based) is LEVELS[n - 1]. Past the table, every 10 more hours grant water and a rock. */
export const LEVELS: readonly LevelDef[] = [
  { minutes: 0, grants: {} },
  { minutes: 30, grants: { water: 2 } },
  { minutes: 90, grants: { rock: 2, water: 1 } },
  { minutes: 180, grants: { log: 1, water: 2 } },
  { minutes: 300, grants: { hive: 1, rock: 1 } },
  { minutes: 480, grants: { water: 3 } },
  { minutes: 720, grants: { campfire: 1, log: 1 } },
  { minutes: 1020, grants: { water: 2, rock: 2 } },
  { minutes: 1380, grants: { hive: 1, water: 2 } },
  { minutes: 1800, grants: { log: 1, rock: 1, water: 2 } },
];
const EXTRA_LEVEL_MIN = 600;
const EXTRA_GRANTS: Partial<Record<TerrainKind, number>> = { water: 1, rock: 1 };

export function levelDef(level: number): LevelDef {
  if (level <= LEVELS.length) return LEVELS[Math.max(1, level) - 1];
  const last = LEVELS[LEVELS.length - 1].minutes;
  return { minutes: last + (level - LEVELS.length) * EXTRA_LEVEL_MIN, grants: EXTRA_GRANTS };
}

export function levelFor(lifetimeMin: number): number {
  let level = 1;
  while (levelDef(level + 1).minutes <= lifetimeMin + 1e-9) level++;
  return level;
}

/** Progress toward the next level: minutes still needed and the fraction done. */
export function levelProgress(lifetimeMin: number) {
  const level = levelFor(lifetimeMin);
  const from = levelDef(level).minutes;
  const to = levelDef(level + 1).minutes;
  return {
    level,
    minutesToNext: Math.max(0, Math.ceil(to - lifetimeMin - 1e-9)),
    fraction: (lifetimeMin - from) / (to - from),
    nextGrants: levelDef(level + 1).grants,
  };
}

export function emptyStock(): Record<TerrainKind, number> {
  return { water: 0, rock: 0, log: 0, hive: 0, campfire: 0 };
}

export function createNature(): Nature {
  return { stock: emptyStock(), levelClaimed: 1, discovered: {} };
}

/** Hand out the rewards of every level reached but not yet claimed. */
export function claimLevels(state: GameState): { state: GameState; granted: Partial<Record<TerrainKind, number>> } {
  const level = levelFor(state.economy.lifetimeFocusMin);
  if (level <= state.nature.levelClaimed) return { state, granted: {} };
  const stock = { ...state.nature.stock };
  const granted: Partial<Record<TerrainKind, number>> = {};
  for (let l = state.nature.levelClaimed + 1; l <= level; l++) {
    for (const [kind, n] of Object.entries(levelDef(l).grants) as [TerrainKind, number][]) {
      stock[kind] += n;
      granted[kind] = (granted[kind] ?? 0) + n;
    }
  }
  return { state: { ...state, nature: { ...state.nature, stock, levelClaimed: level } }, granted };
}

export const TERRAIN_INFO: Record<TerrainKind, { name: string; blurb: string }> = {
  water: { name: 'Water', blurb: 'Join tiles into ponds and lakes. At the edge it becomes a waterfall.' },
  rock: { name: 'Rock', blurb: 'A sunny stone to rest beside.' },
  log: { name: 'Hollow log', blurb: 'A home for small, shy creatures.' },
  hive: { name: 'Beehive', blurb: 'Bees come when there are flowers to visit.' },
  campfire: { name: 'Campfire', blurb: 'A warm glow for long evenings.' },
};

// ---------------------------------------------------------------------------
// Placing nature pieces
// ---------------------------------------------------------------------------

export type PlaceResult =
  | { ok: true; state: GameState; islandGrew: boolean }
  | { ok: false; reason: 'noStock' | 'outOfBounds' | 'occupied' };

export function placeTerrain(
  state: GameState,
  kind: TerrainKind,
  x: number,
  y: number,
  grow: (world: World) => World,
): PlaceResult {
  if ((state.nature.stock[kind] ?? 0) <= 0) return { ok: false, reason: 'noStock' };
  if (!isTileInRadius(x, y, state.world.radius)) return { ok: false, reason: 'outOfBounds' };
  const key = tileKey(x, y);
  if (state.world.tiles[key] || state.world.terrain[key]) return { ok: false, reason: 'occupied' };
  const world = grow({ ...state.world, terrain: { ...state.world.terrain, [key]: kind } });
  return {
    ok: true,
    islandGrew: world.radius > state.world.radius,
    state: {
      ...state,
      world,
      nature: { ...state.nature, stock: { ...state.nature.stock, [kind]: state.nature.stock[kind] - 1 } },
    },
  };
}

/** Pick a nature piece back up into the stock. */
export function removeTerrain(state: GameState, x: number, y: number): GameState {
  const key = tileKey(x, y);
  const kind = state.world.terrain[key];
  if (!kind) return state;
  const terrain = { ...state.world.terrain };
  delete terrain[key];
  return {
    ...state,
    world: { ...state.world, terrain },
    nature: { ...state.nature, stock: { ...state.nature.stock, [kind]: state.nature.stock[kind] + 1 } },
  };
}

// ---------------------------------------------------------------------------
// Water bodies
// ---------------------------------------------------------------------------

export interface WaterBody {
  tiles: string[];
  /** 1-2 tiles: pond, 3+: lake. */
  kind: 'pond' | 'lake';
  /** Tiles on the island's rim, where water spills over as a waterfall. */
  falls: string[];
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Group water tiles into connected bodies (4-neighbourhood). */
export function waterBodies(world: Pick<World, 'terrain' | 'radius'>): WaterBody[] {
  const water = new Set(Object.keys(world.terrain).filter((k) => world.terrain[k] === 'water'));
  const seen = new Set<string>();
  const bodies: WaterBody[] = [];
  for (const start of [...water].sort()) {
    if (seen.has(start)) continue;
    const tiles: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const key = queue.pop()!;
      tiles.push(key);
      const { x, y } = parseTile(key);
      for (const [dx, dy] of NEIGHBOURS) {
        const n = tileKey(x + dx, y + dy);
        if (water.has(n) && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    tiles.sort();
    // Only the two front faces of the island are visible, so falls spill toward +x or +y.
    const falls = tiles.filter((k) => {
      const { x, y } = parseTile(k);
      return !isTileInRadius(x + 1, y, world.radius) || !isTileInRadius(x, y + 1, world.radius);
    });
    bodies.push({ tiles, kind: tiles.length >= 3 ? 'lake' : 'pond', falls });
  }
  return bodies;
}

// ---------------------------------------------------------------------------
// Wildlife
// ---------------------------------------------------------------------------

export interface Habitat {
  plants: number;
  flowers: number;
  /** Low plants: flowers, ferns and clover. */
  ground: number;
  trees: number;
  mushrooms: number;
  water: number;
  ponds: number;
  lakes: number;
  biggestWater: number;
  falls: number;
  rock: number;
  log: number;
  hive: number;
  campfire: number;
  /** Free land tiles (no plant, no nature piece). */
  freeLand: number;
  landTiles: number;
}

export function habitatOf(world: World, seeds: Record<string, Seed>): Habitat {
  const kinds: Partial<Record<PlantKind, number>> = {};
  let plants = 0;
  for (const seedId of Object.values(world.tiles)) {
    const seed = seeds[seedId];
    if (!seed) continue;
    plants++;
    const k = getSpecies(seed.speciesId).kind;
    kinds[k] = (kinds[k] ?? 0) + 1;
  }
  const bodies = waterBodies(world);
  const count = (kind: TerrainKind) => Object.values(world.terrain).filter((k) => k === kind).length;
  let tiles = 0;
  for (let y = -world.radius; y <= world.radius; y++)
    for (let x = -world.radius; x <= world.radius; x++) if (isTileInRadius(x, y, world.radius)) tiles++;
  const water = count('water');
  const occupied = plants + Object.keys(world.terrain).length;
  return {
    plants,
    flowers: kinds.flower ?? 0,
    ground: (kinds.flower ?? 0) + (kinds.fern ?? 0),
    trees: (kinds.tree ?? 0) + (kinds.pine ?? 0),
    mushrooms: kinds.mushroom ?? 0,
    water,
    ponds: bodies.filter((b) => b.kind === 'pond').length,
    lakes: bodies.filter((b) => b.kind === 'lake').length,
    biggestWater: bodies.reduce((m, b) => Math.max(m, b.tiles.length), 0),
    falls: bodies.reduce((m, b) => m + b.falls.length, 0),
    rock: count('rock'),
    log: count('log'),
    hive: count('hive'),
    campfire: count('campfire'),
    freeLand: Math.max(0, tiles - occupied),
    landTiles: tiles - water,
  };
}

export type Movement = 'walk' | 'hop' | 'swim' | 'fish' | 'fly' | 'flutter' | 'swarm' | 'perch';

export interface AnimalDef {
  id: string;
  name: string;
  /** Short line for the journal once found. */
  blurb: string;
  /** What it needs, shown as a hint before it is found. */
  hint: string;
  movement: Movement;
  /** Only shows up at night (it still counts as living on the island). */
  nocturnal?: boolean;
  /** Below this vitality it hides away until the island recovers. */
  shy: number;
  /** How many live on the island (0 = the habitat does not suit it). */
  population: (h: Habitat) => number;
  sound: string;
}

const cap = (n: number, max: number) => Math.max(0, Math.min(max, Math.floor(n)));

export const ANIMALS: readonly AnimalDef[] = [
  {
    id: 'butterfly',
    name: 'Butterflies',
    blurb: 'They dance from flower to flower.',
    hint: 'Grow 2 flowers',
    movement: 'flutter',
    shy: 0.35,
    population: (h) => (h.flowers >= 2 ? cap(h.flowers / 2, 3) : 0),
    sound: 'flutter',
  },
  {
    id: 'bird',
    name: 'Songbird',
    blurb: 'Sings whenever you finish a session.',
    hint: 'Grow a tree',
    movement: 'fly',
    shy: 0.3,
    population: (h) => (h.trees >= 1 ? cap(1 + h.trees / 4, 3) : 0),
    sound: 'chirp',
  },
  {
    id: 'frog',
    name: 'Frog',
    blurb: 'Croaks louder after every pond.',
    hint: 'Place water',
    movement: 'hop',
    shy: 0.3,
    population: (h) => (h.water >= 1 ? cap(1 + h.ponds / 2, 2) : 0),
    sound: 'ribbit',
  },
  {
    id: 'rabbit',
    name: 'Rabbit',
    blurb: 'Nibbles clover and keeps an ear out.',
    hint: 'Grow 4 flowers or ferns',
    movement: 'hop',
    shy: 0.45,
    population: (h) => (h.ground >= 4 ? cap(h.ground / 4, 2) : 0),
    sound: 'squeak',
  },
  {
    id: 'squirrel',
    name: 'Squirrel',
    blurb: 'Hides acorns it will never find again.',
    hint: 'Grow 2 trees',
    movement: 'walk',
    shy: 0.4,
    population: (h) => (h.trees >= 2 ? 1 : 0),
    sound: 'squeak',
  },
  {
    id: 'duck',
    name: 'Duck',
    blurb: 'Paddles in slow, contented circles.',
    hint: 'Join 2 water tiles',
    movement: 'swim',
    shy: 0.4,
    population: (h) => (h.biggestWater >= 2 ? cap(h.water / 3 + 1, 2) : 0),
    sound: 'quack',
  },
  {
    id: 'bee',
    name: 'Bees',
    blurb: 'Busy, like you.',
    hint: 'Place a beehive near 3 flowers',
    movement: 'swarm',
    shy: 0.4,
    population: (h) => (h.hive >= 1 && h.flowers >= 3 ? cap(2 + h.hive, 4) : 0),
    sound: 'buzz',
  },
  {
    id: 'hedgehog',
    name: 'Hedgehog',
    blurb: 'Snuffles under the mushrooms.',
    hint: 'A hollow log and a mushroom',
    movement: 'walk',
    shy: 0.5,
    population: (h) => (h.log >= 1 && h.mushrooms >= 1 ? 1 : 0),
    sound: 'sniff',
  },
  {
    id: 'fish',
    name: 'Fish',
    blurb: 'Leaps when nobody is watching.',
    hint: 'Make a lake of 3 water tiles',
    movement: 'fish',
    shy: 0.25,
    population: (h) => (h.lakes >= 1 ? cap(h.biggestWater / 2, 3) : 0),
    sound: 'splash',
  },
  {
    id: 'deer',
    name: 'Deer',
    blurb: 'Only visits islands that feel safe.',
    hint: '3 trees and a lake',
    movement: 'walk',
    shy: 0.6,
    population: (h) => (h.trees >= 3 && h.lakes >= 1 ? cap(1 + h.trees / 8, 2) : 0),
    sound: 'snort',
  },
  {
    id: 'fox',
    name: 'Fox',
    blurb: 'Curious, clever and a little proud.',
    hint: '10 plants and a hollow log',
    movement: 'walk',
    shy: 0.65,
    population: (h) => (h.plants >= 10 && h.log >= 1 ? 1 : 0),
    sound: 'yip',
  },
  {
    id: 'owl',
    name: 'Owl',
    blurb: 'Keeps watch over your island at night.',
    hint: 'Grow 4 trees',
    movement: 'perch',
    nocturnal: true,
    shy: 0.5,
    population: (h) => (h.trees >= 4 ? 1 : 0),
    sound: 'hoot',
  },
  {
    id: 'firefly',
    name: 'Fireflies',
    blurb: 'Little lanterns over the water.',
    hint: 'Water and 6 plants',
    movement: 'swarm',
    nocturnal: true,
    shy: 0.5,
    population: (h) => (h.water >= 1 && h.plants >= 6 ? cap(4 + h.water, 8) : 0),
    sound: 'twinkle',
  },
];

const ANIMAL_BY_ID: Record<string, AnimalDef> = Object.fromEntries(ANIMALS.map((a) => [a.id, a]));

export function getAnimal(id: string): AnimalDef | undefined {
  return ANIMAL_BY_ID[id];
}

export interface Resident {
  id: string;
  count: number;
  /** False while it hides because the island is wilting. */
  present: boolean;
}

/** Every animal whose habitat is on the island, and whether it is out right now. */
export function residents(world: World, seeds: Record<string, Seed>, vitality: number): Resident[] {
  const h = habitatOf(world, seeds);
  const out: Resident[] = [];
  for (const a of ANIMALS) {
    const count = a.population(h);
    if (count > 0) out.push({ id: a.id, count, present: vitality >= a.shy });
  }
  return out;
}

/** Record animals that moved in for the first time. Returns their ids for a welcome. */
export function discoverWildlife(
  state: GameState,
  vitality: number,
  now: number,
  night = true,
): { state: GameState; arrived: string[] } {
  const arrived = residents(state.world, state.seeds, vitality)
    // Night animals are only met at night: they cannot be seen during the day.
    .filter((r) => r.present && state.nature.discovered[r.id] == null && (night || !ANIMAL_BY_ID[r.id].nocturnal))
    .map((r) => r.id);
  if (arrived.length === 0) return { state, arrived };
  const discovered = { ...state.nature.discovered };
  for (const id of arrived) discovered[id] = now;
  return { state: { ...state, nature: { ...state.nature, discovered } }, arrived };
}

export function sanitizeStock(raw: unknown): Record<TerrainKind, number> {
  const stock = emptyStock();
  if (raw && typeof raw === 'object') {
    for (const k of TERRAIN_KINDS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'number' && v > 0) stock[k] = Math.floor(v);
    }
  }
  return stock;
}
