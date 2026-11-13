import { describe, expect, it } from 'vitest';
import { HOUR_MS } from '../config';
import { createInitialState, migrate, resolveSession, startSession } from '../engine';
import {
  ANIMALS,
  LEVELS,
  claimLevels,
  discoverWildlife,
  getAnimal,
  habitatOf,
  levelDef,
  levelFor,
  levelProgress,
  placeTerrain,
  removeTerrain,
  residents,
  waterBodies,
} from '../nature';
import { mulberry32 } from '../rng';
import { SPECIES } from '../species';
import type { GameState, Seed, TerrainKind } from '../types';
import { growIsland, plantSeed, plantsUntilExpansion, tilesInRadius } from '../world';

const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);

function runSession(state: GameState, minutes: number, at: number, seed = 1) {
  const rand = mulberry32(seed);
  const s = startSession(state, minutes * 60, 0, at, rand);
  if (!s.ok) throw new Error(s.reason);
  const r = resolveSession(s.state, at + minutes * 60_000, rand);
  if (r.kind !== 'completed') throw new Error(r.kind);
  return r;
}

/** A state with the given plants placed (species id -> count) and nature pieces in stock. */
function island(plants: Record<string, number>, stock: Partial<Record<TerrainKind, number>> = {}, radius = 4) {
  let state = createInitialState(T0);
  const seeds: Record<string, Seed> = {};
  const tiles: Record<string, string> = {};
  const free = tilesInRadius(radius);
  let i = 0;
  for (const [speciesId, n] of Object.entries(plants)) {
    const sp = SPECIES.find((s) => s.id === speciesId)!;
    for (let k = 0; k < n; k++) {
      const t = free[free.length - 1 - i++];
      const id = `seed${i}`;
      seeds[id] = { id, speciesId, rarity: sp.rarity, earnedAt: T0, source: 'session', tile: t.key, plantedAt: T0 };
      tiles[t.key] = id;
    }
  }
  state = {
    ...state,
    seeds,
    world: { ...state.world, radius, tiles },
    nature: { ...state.nature, stock: { ...state.nature.stock, ...stock } },
  };
  return state;
}

function place(state: GameState, kind: TerrainKind, x: number, y: number) {
  const r = placeTerrain(state, kind, x, y, growIsland);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

describe('island levels', () => {
  it('climbs with lifetime focus and keeps going past the table', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(29)).toBe(1);
    expect(levelFor(30)).toBe(2);
    expect(levelFor(1800)).toBe(LEVELS.length);
    expect(levelFor(2400)).toBe(LEVELS.length + 1);
    expect(levelFor(100_000)).toBeGreaterThan(100);
    for (let l = 1; l < 40; l++) expect(levelDef(l + 1).minutes).toBeGreaterThan(levelDef(l).minutes);
    const p = levelProgress(60);
    expect(p.level).toBe(2);
    expect(p.minutesToNext).toBe(30);
    expect(p.fraction).toBeCloseTo(0.5, 9);
  });

  it('hands out every reached level exactly once', () => {
    const base = createInitialState(T0);
    const rich = { ...base, economy: { ...base.economy, lifetimeFocusMin: 300 } };
    const first = claimLevels(rich);
    expect(first.granted).toMatchObject({ water: 5, rock: 3, log: 1, hive: 1 });
    expect(first.state.nature.stock).toMatchObject({ water: 5, rock: 3, log: 1, hive: 1, campfire: 0 });
    expect(first.state.nature.levelClaimed).toBe(5);
    const again = claimLevels(first.state);
    expect(again.granted).toEqual({});
    expect(again.state).toBe(first.state);
  });

  it('a session that crosses a level reports it and grants the pieces', () => {
    const a = runSession(createInitialState(T0), 25, T0);
    expect(a.summary.levelBefore).toBe(1);
    expect(a.summary.levelAfter).toBe(1);
    expect(a.summary.granted).toEqual({});
    const b = runSession(a.state, 10, T0 + HOUR_MS, 2);
    expect(b.summary.levelBefore).toBe(1);
    expect(b.summary.levelAfter).toBe(2);
    expect(b.summary.granted).toEqual({ water: 2 });
    expect(b.state.nature.stock.water).toBe(2);
  });
});

describe('placing nature pieces', () => {
  it('uses stock, checks the tile and gives pieces back', () => {
    let state = island({ daisy: 1 }, { water: 1, rock: 1 }, 1);
    const plantTile = Object.keys(state.world.tiles)[0].split(',').map(Number);
    expect(placeTerrain(state, 'log', 0, 0, growIsland)).toEqual({ ok: false, reason: 'noStock' });
    expect(placeTerrain(state, 'water', 9, 9, growIsland)).toEqual({ ok: false, reason: 'outOfBounds' });
    expect(placeTerrain(state, 'water', plantTile[0], plantTile[1], growIsland)).toEqual({ ok: false, reason: 'occupied' });
    state = place(state, 'water', 0, 0);
    expect(state.world.terrain['0,0']).toBe('water');
    expect(state.nature.stock.water).toBe(0);
    expect(placeTerrain(state, 'rock', 0, 0, growIsland)).toEqual({ ok: false, reason: 'occupied' });
    // A plant cannot go on water either.
    const seed: Seed = { id: 'x', speciesId: 'tulip', rarity: 'common', earnedAt: T0, source: 'session', tile: null, plantedAt: null };
    expect(plantSeed({ ...state, seeds: { ...state.seeds, x: seed } }, 'x', 0, 0, T0)).toEqual({ ok: false, reason: 'occupied' });
    const back = removeTerrain(state, 0, 0);
    expect(back.world.terrain['0,0']).toBeUndefined();
    expect(back.nature.stock.water).toBe(1);
    expect(removeTerrain(back, 0, 0)).toBe(back);
  });

  it('counts nature pieces toward growing the island', () => {
    let state = island({}, { water: 7 }, 1);
    expect(plantsUntilExpansion(state.world)).toBe(7);
    let grew = false;
    for (const t of tilesInRadius(1).slice(0, 7)) {
      const r = placeTerrain(state, 'water', t.x, t.y, growIsland);
      if (!r.ok) throw new Error(r.reason);
      grew = grew || r.islandGrew;
      state = r.state;
    }
    expect(grew).toBe(true);
    expect(state.world.radius).toBe(2);
  });
});

describe('water', () => {
  it('joins neighbouring tiles into ponds and lakes, with falls at the front rim', () => {
    let state = island({}, { water: 6 }, 2);
    state = place(state, 'water', -1, -1);
    state = place(state, 'water', 0, -1);
    state = place(state, 'water', 0, 0);
    state = place(state, 'water', -2, 0); // diagonal neighbours do not join
    state = place(state, 'water', 2, 0); // on the rim (x + 1 is off the island)
    const bodies = waterBodies(state.world);
    expect(bodies.map((b) => b.tiles.length).sort()).toEqual([1, 1, 3]);
    const lake = bodies.find((b) => b.tiles.length === 3)!;
    expect(lake.kind).toBe('lake');
    expect(lake.falls).toEqual([]);
    expect(bodies.find((b) => b.tiles.includes('2,0'))!.falls).toEqual(['2,0']);
    // The back rim is hidden behind the island, so it never shows a waterfall.
    expect(bodies.find((b) => b.tiles.includes('-2,0'))!.falls).toEqual([]);
  });
});

describe('wildlife', () => {
  it('reads the habitat from plants and nature pieces', () => {
    let state = island({ daisy: 2, fern: 3, cherry: 2, pine: 1, 'fly-agaric': 1 }, { water: 3, log: 1 });
    state = place(state, 'water', 0, 0);
    state = place(state, 'water', 1, 0);
    state = place(state, 'water', 2, 0);
    state = place(state, 'log', -2, -2);
    const h = habitatOf(state.world, state.seeds);
    expect(h).toMatchObject({ plants: 9, flowers: 2, ground: 5, trees: 3, mushrooms: 1, water: 3, lakes: 1, log: 1 });
    expect(h.landTiles).toBe(69 - 3);
  });

  it('every animal has a reachable habitat and none appears on a bare island', () => {
    expect(residents(createInitialState(T0).world, {}, 1)).toEqual([]);
    let state = island({ daisy: 4, tulip: 2, fern: 4, cherry: 3, pine: 2, 'fly-agaric': 1 }, { water: 4, log: 1, hive: 1 });
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) state = place(state, 'water', x, y);
    state = place(state, 'log', -2, -1);
    state = place(state, 'hive', -1, -2);
    const all = residents(state.world, state.seeds, 1);
    expect(all.map((r) => r.id).sort()).toEqual(ANIMALS.map((a) => a.id).sort());
    for (const r of all) expect(r.count).toBeGreaterThan(0);
  });

  it('a single requirement short keeps an animal away', () => {
    // Deer: 3 trees and a lake.
    let state = island({ cherry: 3 }, { water: 3 });
    state = place(state, 'water', 0, 0);
    state = place(state, 'water', 1, 0);
    expect(residents(state.world, state.seeds, 1).some((r) => r.id === 'deer')).toBe(false);
    state = place(state, 'water', 2, 0);
    expect(residents(state.world, state.seeds, 1).some((r) => r.id === 'deer')).toBe(true);
    // Bees need the hive and flowers.
    const bees = island({ daisy: 3 }, { hive: 1 });
    expect(residents(bees.world, bees.seeds, 1).some((r) => r.id === 'bee')).toBe(false);
    const withHive = place(bees, 'hive', 0, 0);
    expect(residents(withHive.world, withHive.seeds, 1).some((r) => r.id === 'bee')).toBe(true);
  });

  it('animals hide when the island wilts and come back when it recovers', () => {
    let state = island({ cherry: 4, daisy: 4, fern: 2, 'fly-agaric': 1 }, { water: 3, log: 1 });
    for (const [x, y] of [[0, 0], [1, 0], [2, 0]]) state = place(state, 'water', x, y);
    state = place(state, 'log', -1, -1);
    const thriving = residents(state.world, state.seeds, 1);
    expect(thriving.every((r) => r.present)).toBe(true);
    const wilting = residents(state.world, state.seeds, 0.4);
    const gone = wilting.filter((r) => !r.present).map((r) => r.id);
    expect(gone).toContain('deer');
    expect(gone).toContain('fox');
    expect(gone).not.toContain('fish');
    const dormant = residents(state.world, state.seeds, 0);
    expect(dormant.every((r) => !r.present)).toBe(true);
    // Hiding is never losing: the same animals are still listed as residents.
    expect(dormant.map((r) => r.id)).toEqual(thriving.map((r) => r.id));
  });

  it('records each new arrival once, and only while it is out', () => {
    let state = island({ daisy: 2, cherry: 1 });
    const hidden = discoverWildlife(state, 0.1, T0);
    expect(hidden.arrived).toEqual([]);
    const first = discoverWildlife(state, 1, T0);
    expect(first.arrived.sort()).toEqual(['bird', 'butterfly']);
    expect(first.state.nature.discovered.bird).toBe(T0);
    const again = discoverWildlife(first.state, 1, T0 + 1);
    expect(again.arrived).toEqual([]);
    expect(again.state).toBe(first.state);
    state = again.state;
  });

  it('meets night animals only at night', () => {
    let state = island({ cherry: 4 });
    const day = discoverWildlife(state, 1, T0, false);
    expect(day.arrived).not.toContain('owl');
    expect(day.arrived).toContain('bird');
    const night = discoverWildlife(day.state, 1, T0, true);
    expect(night.arrived).toEqual(['owl']);
    state = night.state;
  });

  it('has a consistent catalogue', () => {
    const ids = new Set(ANIMALS.map((a) => a.id));
    expect(ids.size).toBe(ANIMALS.length);
    for (const a of ANIMALS) {
      expect(getAnimal(a.id)).toBe(a);
      expect(a.shy).toBeGreaterThan(0);
      expect(a.shy).toBeLessThan(1);
      expect(a.hint.length).toBeGreaterThan(3);
    }
  });
});

describe('save migration', () => {
  it('upgrades a save from before the living island and grants past levels', () => {
    const old = runSession(createInitialState(T0), 25, T0).state as Partial<GameState> & Record<string, unknown>;
    const v1 = JSON.parse(JSON.stringify(old));
    delete v1.nature;
    delete v1.world.terrain;
    v1.schemaVersion = 1;
    v1.economy.lifetimeFocusMin = 200; // level 4
    const up = migrate(v1, T0);
    expect(up.schemaVersion).toBe(3);
    expect(up.world.terrain).toEqual({});
    expect(up.nature.levelClaimed).toBe(4);
    expect(up.nature.stock).toMatchObject({ water: 5, rock: 2, log: 1, hive: 0, campfire: 0 });
    expect(up.nature.discovered).toEqual({});
    // Migrating twice changes nothing.
    expect(migrate(JSON.parse(JSON.stringify(up)), T0)).toEqual(up);
  });

  it('drops garbage stock values', () => {
    const s = migrate({ nature: { stock: { water: -3, rock: 'x', log: 2.7 }, levelClaimed: 1 } }, T0);
    expect(s.nature.stock).toMatchObject({ water: 0, rock: 0, log: 2, hive: 0, campfire: 0 });
  });
});
