import { describe, expect, it } from 'vitest';
import { CONFIG, DAY_MS, HOUR_MS } from '../config';
import { createInitialState, resolveSession, startSession } from '../engine';
import { placeTerrain } from '../nature';
import { mulberry32 } from '../rng';
import { SPECIES } from '../species';
import { plantDiesAfterHours, settleIsland, zeroAt } from '../stakes';
import { dayIndex } from '../time';
import type { GameState, Seed } from '../types';
import { VARIANTS, getVariant, rollVariant, variantChance, variantHardyHours } from '../variants';
import { VISITORS, visitorHere, visitorPassing, visitorResident, visitorWaiting } from '../visitors';
import { growIsland, tilesInRadius, unplantedSeeds } from '../world';

const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);

function session(state: GameState, minutes: number, endAt: number, seed = 1) {
  const rand = mulberry32(seed);
  const s = startSession(state, minutes * 60, 0, endAt - minutes * 60_000, rand);
  if (!s.ok) throw new Error(s.reason);
  const r = resolveSession(s.state, endAt, rand);
  if (r.kind !== 'completed') throw new Error(r.kind);
  return r;
}

describe('seeds take real focus', () => {
  it('a new player starts with one seed to plant', () => {
    const s = createInitialState(T0);
    expect(unplantedSeeds(s).map((x) => x.speciesId)).toEqual(['clover']);
  });

  it('a session under 20 minutes drops no seed but still counts for everything else', () => {
    const r = session(createInitialState(T0), 19, T0 + HOUR_MS);
    expect(r.summary.seed).toBeNull();
    expect(Object.keys(r.state.seeds)).toEqual(['starter']);
    expect(r.state.sessions[0].seedId).toBeUndefined();
    expect(r.summary.coinsEarned).toBe(19);
    expect(r.summary.qualifiedForStreak).toBe(true);
    expect(r.state.progress.pityCounter).toBe(0);
    expect(r.state.world.vitality).toBe(1);
  });

  it('twenty minutes in one go drops one; twenty one-minute sessions drop none', () => {
    expect(session(createInitialState(T0), CONFIG.rewards.minSeedMin, T0 + HOUR_MS).summary.seed).not.toBeNull();
    let s = createInitialState(T0);
    for (let i = 0; i < 20; i++) s = session(s, 1, T0 + (i + 1) * 5 * 60_000, i + 1).state;
    expect(Object.keys(s.seeds)).toEqual(['starter']);
    expect(s.economy.lifetimeFocusMin).toBe(20);
  });
});

describe('variants', () => {
  it('every variant can occur on some plant and has a tell', () => {
    const kinds = new Set(SPECIES.map((s) => s.kind));
    for (const v of VARIANTS) {
      expect(v.kinds.some((k) => kinds.has(k))).toBe(true);
      expect(v.tell.length).toBeGreaterThan(20);
      expect(getVariant(v.id)).toBe(v);
    }
    expect(new Set(VARIANTS.map((v) => v.id)).size).toBe(VARIANTS.length);
  });

  it('are rare: about one tree seed in eight, and the rarer the tier the fewer', () => {
    expect(variantChance('tree', 25)).toBeGreaterThan(0.08);
    expect(variantChance('tree', 25)).toBeLessThan(0.16);
    expect(variantChance('crystal', 25)).toBeLessThan(0.06);
    const rand = mulberry32(5);
    const count: Record<string, number> = {};
    const N = 60_000;
    for (let i = 0; i < N; i++) {
      const v = rollVariant('tree', 25, rand);
      if (v) count[v] = (count[v] ?? 0) + 1;
    }
    for (const v of VARIANTS.filter((x) => x.kinds.includes('tree'))) {
      expect(count[v.id] / N).toBeGreaterThan(v.chance * 0.6);
      expect(count[v.id] / N).toBeLessThan(v.chance * 1.5);
    }
    expect(count.twin).toBeUndefined();
    expect(count.lightning).toBeLessThan(count.nesting);
    expect(count.nesting).toBeLessThan(count.ivy);
    expect(count.ivy).toBeLessThan(count.mossy);
  });

  it('longer sessions are a little luckier', () => {
    expect(variantChance('tree', 50)).toBeCloseTo(variantChance('tree', 25) * 2);
    expect(variantChance('tree', 120)).toBe(variantChance('tree', 50));
  });

  it('are recorded on the seed and counted in the collection', () => {
    let s = createInitialState(T0);
    let found: Seed | null = null;
    for (let i = 0; i < 400 && !found; i++) {
      const r = session(s, 50, T0 + (i + 1) * HOUR_MS, i + 11);
      s = r.state;
      if (r.summary.seed?.variant) found = r.summary.seed;
    }
    expect(found).not.toBeNull();
    expect(s.progress.variants[found!.variant!]).toBeGreaterThanOrEqual(1);
    expect(getVariant(found!.variant)!.kinds).toContain(SPECIES.find((x) => x.id === found!.speciesId)!.kind);
  });

  it('a variant plant holds out longer in a drought', () => {
    expect(variantHardyHours('mossy')).toBe(12);
    expect(variantHardyHours('lightning')).toBe(96);
    expect(variantHardyHours(null)).toBe(0);
    let s = session(createInitialState(T0), 25, T0).state;
    const plain: Seed = { id: 'a', speciesId: 'tulip', rarity: 'common', earnedAt: T0, source: 'session', tile: '0,0', plantedAt: T0 };
    s = { ...s, seeds: { a: plain }, world: { ...s.world, tiles: { '0,0': 'a' } } };
    const limit = plantDiesAfterHours('0,0', 'common');
    const at = zeroAt(s.world) + (limit + 2) * HOUR_MS;
    expect(settleIsland(s, at).state.seeds.a.diedAt).not.toBeNull();
    const mossy = { ...s, seeds: { a: { ...plain, variant: 'mossy' } } };
    expect(settleIsland(mossy, at).state.seeds.a.diedAt ?? null).toBeNull();
    expect(settleIsland(mossy, at + 12 * HOUR_MS).state.seeds.a.diedAt).not.toBeNull();
  });
});

describe('daily visitor', () => {
  /** An island with trees, plants and a lake: everybody could stop here. */
  const island = () => {
    let s = createInitialState(T0 - DAY_MS);
    const seeds: Record<string, Seed> = {};
    const tiles: Record<string, string> = {};
    const free = tilesInRadius(3);
    ['cherry', 'maple', 'pine', 'daisy', 'tulip', 'fern', 'clover', 'daisy', 'tulip'].forEach((speciesId, i) => {
      const t = free[free.length - 1 - i];
      seeds[`s${i}`] = { id: `s${i}`, speciesId, rarity: 'common', earnedAt: T0, source: 'session', tile: t.key, plantedAt: T0 };
      tiles[t.key] = `s${i}`;
    });
    s = { ...s, seeds, world: { ...s.world, radius: 3, tiles }, nature: { ...s.nature, stock: { ...s.nature.stock, water: 2 } } };
    for (const [x, y] of [[-3, 0], [-2, 0]]) {
      const r = placeTerrain(s, 'water', x, y, growIsland);
      if (!r.ok) throw new Error(r.reason);
      s = r.state;
    }
    return s;
  };

  it('nobody stops at an empty island', () => {
    const s = createInitialState(T0);
    expect(visitorPassing(s, dayIndex(T0))).toBeNull();
    expect(visitorWaiting(s, T0)).toBeNull();
  });

  it('someone passes by every day, the same one all day, and all of them over time', () => {
    const s = island();
    const seen = new Set<string>();
    for (let d = 0; d < 120; d++) {
      const id = visitorPassing(s, dayIndex(T0) + d);
      expect(id).not.toBeNull();
      seen.add(id!);
    }
    expect([...seen].sort()).toEqual(VISITORS.map((v) => v.id).sort());
    expect(visitorPassing(s, dayIndex(T0))).toBe(visitorPassing(s, dayIndex(T0)));
  });

  it('only visitors the island suits pass by', () => {
    let s = createInitialState(T0);
    const seeds: Record<string, Seed> = {};
    const tiles: Record<string, string> = {};
    tilesInRadius(1).slice(0, 4).forEach((t, i) => {
      seeds[`s${i}`] = { id: `s${i}`, speciesId: 'daisy', rarity: 'common', earnedAt: T0, source: 'session', tile: t.key, plantedAt: T0 };
      tiles[t.key] = `s${i}`;
    });
    s = { ...s, seeds, world: { ...s.world, tiles } };
    for (let d = 0; d < 40; d++) expect(visitorPassing(s, d)).toBe('snowhare');
  });

  it('lands only when you focus that day, stays for the day and is counted', () => {
    const s = island();
    const waiting = visitorWaiting(s, T0);
    expect(waiting).not.toBeNull();
    expect(visitorHere(s, T0)).toBeNull();
    expect(visitorResident(s, T0)).toEqual([]);

    // Too short to count: nobody lands.
    expect(visitorHere(session(s, 5, T0).state, T0)).toBeNull();

    const r = session(s, 15, T0);
    expect(visitorHere(r.state, T0)).toBe(waiting);
    expect(visitorWaiting(r.state, T0)).toBeNull();
    expect(r.summary.news.find((n) => n.kind === 'visited')).toMatchObject({ subject: waiting, count: 1 });
    expect(r.state.nature.visitors[waiting!]).toBe(1);
    expect(visitorResident(r.state, T0 + HOUR_MS)).toMatchObject([{ id: waiting, count: 1, present: true }]);

    // A second session the same day changes nothing.
    const again = session(r.state, 15, T0 + HOUR_MS, 3);
    expect(again.state.nature.visitors[waiting!]).toBe(1);
    expect(again.summary.news.some((n) => n.kind === 'visited')).toBe(false);

    // Tomorrow it is gone, and someone may be waiting again.
    expect(visitorHere(r.state, T0 + DAY_MS)).toBeNull();
    expect(visitorWaiting(r.state, T0 + DAY_MS)).not.toBeNull();
  });
});
