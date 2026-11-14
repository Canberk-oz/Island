import { describe, expect, it } from 'vitest';
import { CONFIG, DAY_MS, HOUR_MS } from '../config';
import { vitalityNow } from '../decay';
import { createInitialState, migrate, openApp, resolveSession, startSession, witherSession } from '../engine';
import { discoverWildlife, habitatOf, placeTerrain } from '../nature';
import { mulberry32 } from '../rng';
import { SPECIES } from '../species';
import {
  bondLevel,
  droughtNow,
  islandResidents,
  leaveAfterHours,
  plantDiesAfterHours,
  residentContext,
  revivePlant,
  settleIsland,
  stumps,
  syncLandmarks,
  threats,
  unseenNews,
  waterLevel,
  waterLevelOf,
  witherMarks,
  zeroAt,
} from '../stakes';
import { getAnimal } from '../nature';
import type { GameState, Seed, TerrainKind } from '../types';
import { digUp, growIsland, tilesInRadius } from '../world';

const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);
const S = CONFIG.stakes;
/** Hours from a full, freshly fed island to zero vitality. */
const TO_ZERO = CONFIG.decay.graceHours + CONFIG.decay.hoursToEmpty;

function session(state: GameState, minutes: number, endAt: number, seed = 1) {
  const rand = mulberry32(seed);
  const s = startSession(state, minutes * 60, 0, endAt - minutes * 60_000, rand);
  if (!s.ok) throw new Error(s.reason);
  const r = resolveSession(s.state, endAt, rand);
  if (r.kind !== 'completed') throw new Error(r.kind);
  return r;
}

/** A big island with a home for every animal, fed to full vitality at T0, with everyone discovered. */
function richIsland(): GameState {
  let state = createInitialState(T0 - DAY_MS);
  const plants: Record<string, number> = { daisy: 4, tulip: 3, fern: 3, clover: 3, 'button-mushroom': 2, pine: 2, cherry: 2, maple: 1, 'golden-oak': 1 };
  const seeds: Record<string, Seed> = {};
  const tiles: Record<string, string> = {};
  const free = tilesInRadius(4);
  let i = 0;
  for (const [speciesId, n] of Object.entries(plants)) {
    const sp = SPECIES.find((x) => x.id === speciesId)!;
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
    world: { ...state.world, radius: 4, tiles },
    nature: { ...state.nature, stock: { ...state.nature.stock, water: 4, log: 1, hive: 1, rock: 1 } },
  };
  const put = (kind: TerrainKind, x: number, y: number) => {
    const r = placeTerrain(state, kind, x, y, growIsland);
    if (!r.ok) throw new Error(`${kind} ${r.reason}`);
    state = r.state;
  };
  put('water', -4, 0);
  put('water', -3, 0);
  put('water', -2, 0);
  put('water', -4, 1);
  put('log', -3, -2);
  put('hive', -2, -3);
  // One qualifying session ending at T0 starts the clock: full vitality, 20 h of grace.
  state = session(state, 25, T0).state;
  state = discoverWildlife(state, 1, T0, true, residentContext(state, T0)).state;
  return state;
}

const open = (state: GameState, at: number) => openApp(state, at);
const ids = (state: GameState, at: number) => islandResidents(state, at).map((r) => r.id);

describe('drought meter', () => {
  it('stays at zero until the island is completely wilted, then counts hours', () => {
    const s = richIsland();
    expect(zeroAt(s.world)).toBe(T0 + TO_ZERO * HOUR_MS);
    expect(droughtNow(s, T0 + 91 * HOUR_MS)).toBe(0);
    expect(droughtNow(s, T0 + (TO_ZERO + 10) * HOUR_MS)).toBeCloseTo(10);
  });

  it('is settled once: settling twice at the same time changes nothing', () => {
    const s = richIsland();
    const at = T0 + (TO_ZERO + 30) * HOUR_MS;
    const once = settleIsland(s, at).state;
    expect(once.nature.drought).toBeCloseTo(30);
    expect(settleIsland(once, at).state).toBe(once);
    expect(droughtNow(once, at + 5 * HOUR_MS)).toBeCloseTo(35);
  });

  it('returns the same state while the island is healthy', () => {
    const s = richIsland();
    expect(settleIsland(s, T0 + 10 * HOUR_MS).state).toBe(s);
  });

  it('is paid back by focus, an hour per minute', () => {
    const s = settleIsland(richIsland(), T0 + (TO_ZERO + 30) * HOUR_MS).state;
    const after = session(s, 20, T0 + (TO_ZERO + 30) * HOUR_MS + 20 * 60_000).state;
    // 20 more minutes of drought while the session ran, then 20 hours paid back.
    expect(after.nature.drought).toBeCloseTo(30 + 20 / 60 - 20, 1);
  });

  it('cannot be reset by a tiny session', () => {
    const at = T0 + (TO_ZERO + 30) * HOUR_MS;
    const s = session(settleIsland(richIsland(), at).state, 1, at + 60_000).state;
    expect(s.nature.drought).toBeGreaterThan(28);
  });
});

describe('animals moving away', () => {
  it('nobody leaves in the first five days of a full island', () => {
    const r = open(richIsland(), T0 + 5 * DAY_MS);
    expect(r.news.filter((n) => n.kind === 'left')).toEqual([]);
    expect(Object.keys(r.state.nature.away)).toEqual([]);
  });

  it('the shyest leaves first and is no longer a resident', () => {
    const s = richIsland();
    expect(ids(s, T0)).toContain('fox');
    const at = T0 + (TO_ZERO + S.leaveAfterHours + 1) * HOUR_MS;
    const r = open(s, at);
    expect(r.news.filter((n) => n.kind === 'left').map((n) => n.subject)).toEqual(['fox']);
    expect(r.state.nature.away.fox.leftAt).toBeCloseTo(at - HOUR_MS, -3);
    expect(ids(r.state, at)).not.toContain('fox');
    expect(unseenNews(r.state.nature).filter((n) => n.kind === 'left').length).toBe(1);
  });

  it('leaves in order of shyness over a long absence', () => {
    const r = open(richIsland(), T0 + 30 * DAY_MS);
    const left = r.news.filter((n) => n.kind === 'left').map((n) => n.subject);
    expect(left.slice(0, 2)).toEqual(['fox', 'deer']);
    expect(left).toContain('fish');
    const times = r.news.filter((n) => n.kind === 'left').map((n) => n.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('animals never met cannot be lost', () => {
    const s = { ...richIsland() };
    const unknown = { ...s, nature: { ...s.nature, discovered: {} } };
    expect(open(unknown, T0 + 30 * DAY_MS).news.filter((n) => n.kind === 'left')).toEqual([]);
  });

  it('comes back after five days of focus', () => {
    let s = open(richIsland(), T0 + (TO_ZERO + S.leaveAfterHours + 1) * HOUR_MS).state;
    // Keep the quest out of this test.
    const base = Math.ceil((T0 + (TO_ZERO + 40) * HOUR_MS) / DAY_MS) * DAY_MS + 12 * HOUR_MS;
    const returned: number[] = [];
    for (let d = 0; d < S.returnDays; d++) {
      s = { ...s, nature: { ...s.nature, revival: null } };
      const r = session(s, 15, base + d * DAY_MS, d + 3);
      s = r.state;
      if (r.summary.news.some((n) => n.kind === 'returned' && n.subject === 'fox')) returned.push(d);
    }
    expect(returned).toEqual([S.returnDays - 1]);
    expect(s.nature.away.fox).toBeUndefined();
  });

  it('two sessions on one day count as one day', () => {
    let s = open(richIsland(), T0 + (TO_ZERO + S.leaveAfterHours + 1) * HOUR_MS).state;
    const day = Math.ceil((T0 + (TO_ZERO + 40) * HOUR_MS) / DAY_MS) * DAY_MS + 12 * HOUR_MS;
    s = session(s, 15, day).state;
    s = session(s, 15, day + HOUR_MS, 9).state;
    expect(s.nature.away.fox.days).toBe(1);
  });
});

describe('friendship', () => {
  const focusDays = (start: GameState, days: number, from = T0 + DAY_MS) => {
    let s = start;
    for (let d = 0; d < days; d++) s = session(s, 15, from + d * DAY_MS, d + 2).state;
    return s;
  };

  it('grows a point per focus day and names the animal when it becomes a friend', () => {
    const s = focusDays(richIsland(), 6);
    expect(s.nature.bonds.fox.points).toBe(6);
    expect(s.nature.bonds.fox.name).toBeNull();
    const r = session(s, 15, T0 + 7 * DAY_MS, 42);
    expect(bondLevel(r.state.nature.bonds.fox.points)).toBe(2);
    expect(typeof r.state.nature.bonds.fox.name).toBe('string');
    expect(r.summary.news.some((n) => n.kind === 'befriended' && n.subject === 'fox')).toBe(true);
    // Swarms are befriended too, but not named.
    expect(r.state.nature.bonds.butterfly.name).toBeNull();
  });

  it('cools while the animal hides and is lost when it leaves, but the name stays', () => {
    const s = focusDays(richIsland(), 8);
    const name = s.nature.bonds.fox.name;
    const last = T0 + 8 * DAY_MS;
    // The fox hides below 65% vitality: 20 h grace + 25.2 h of fading.
    const hidden3d = last + (20 + 0.35 * 72 + 72) * HOUR_MS;
    const cooled = open(s, hidden3d).state;
    expect(cooled.nature.bonds.fox.points).toBeCloseTo(8 - 3, 1);
    const gone = open(s, last + 30 * DAY_MS).state;
    expect(gone.nature.away.fox).toBeDefined();
    expect(gone.nature.bonds.fox).toEqual({ points: 0, name });
  });

  it('a friend waits longer before leaving', () => {
    const fox = getAnimal('fox')!;
    expect(leaveAfterHours(fox, 14, false)).toBe(leaveAfterHours(fox, 0, false) + 3 * S.leaveHoursPerBondLevel);
    expect(leaveAfterHours(fox, 14, true)).toBe(S.familyLeavesAfterHours);
  });
});

describe('young animals', () => {
  it('are born to a befriended animal on a week-long streak, and the family leaves early', () => {
    let s = richIsland();
    const born: string[] = [];
    for (let d = 1; d <= 9; d++) {
      const r = session(s, 15, T0 + d * DAY_MS, d + 2);
      s = r.state;
      born.push(...r.summary.news.filter((n) => n.kind === 'born').map((n) => n.subject));
    }
    expect(born.length).toBe(1);
    const parent = born[0];
    const now = T0 + 9 * DAY_MS;
    expect(islandResidents(s, now).find((r) => r.id === parent)!.young).toBe(true);
    // Ten days later the young one is grown: one more adult.
    const before = islandResidents(s, now).find((r) => r.id === parent)!.count;
    let later = s;
    for (let d = 10; d <= 20; d++) later = session(later, 15, T0 + d * DAY_MS, d).state;
    const grown = islandResidents(later, T0 + 20 * DAY_MS).find((r) => r.id === parent)!;
    expect(grown.young).toBe(false);
    expect(grown.count).toBe(before + 1);
    // Neglect right after the birth: the family is the first to go.
    const r = open(s, now + (TO_ZERO + S.familyLeavesAfterHours + 1) * HOUR_MS);
    expect(r.news.filter((n) => n.kind === 'left')[0].subject).toBe(parent);
    expect(r.state.nature.family[parent]).toBeUndefined();
  });
});

describe('plants dying', () => {
  it('no plant dies before 60 hours of drought and legendary plants hold out longest', () => {
    const s = richIsland();
    for (const [key, id] of Object.entries(s.world.tiles)) {
      expect(plantDiesAfterHours(key, s.seeds[id].rarity)).toBeGreaterThanOrEqual(S.plantDiesAfterHours);
    }
    expect(stumps(open(s, T0 + (TO_ZERO + 59) * HOUR_MS).state)).toEqual([]);
    const month = open(s, T0 + (TO_ZERO + 200) * HOUR_MS).state;
    const dead = stumps(month);
    expect(dead.length).toBeGreaterThan(10);
    expect(dead.some((x) => x.rarity === 'legendary')).toBe(false);
  });

  it('a stump shelters nobody', () => {
    const s = richIsland();
    const dead = open(s, T0 + 60 * DAY_MS).state;
    expect(stumps(dead).length).toBe(Object.keys(s.world.tiles).length);
    expect(habitatOf(dead.world, dead.seeds).plants).toBe(0);
  });

  it('every real session revives one stump, the rarest first', () => {
    const at = T0 + 60 * DAY_MS;
    const dead = open(richIsland(), at).state;
    const n = stumps(dead).length;
    const r = session({ ...dead, nature: { ...dead.nature, revival: { startDay: 0, days: -99 } } }, 15, at + HOUR_MS);
    expect(stumps(r.state).length).toBe(n - 1);
    expect(r.summary.news.find((x) => x.kind === 'revived')!.subject).toBe('golden-oak');
    // A session too short to count revives nothing.
    expect(stumps(session(dead, 5, at + HOUR_MS).state).length).toBe(n);
  });

  it('coins revive a stump at once; clearing it destroys the plant', () => {
    const at = T0 + 60 * DAY_MS;
    const dead = open(richIsland(), at).state;
    const key = Object.keys(dead.world.tiles).find((k) => dead.seeds[dead.world.tiles[k]].rarity === 'common')!;
    const seedId = dead.world.tiles[key];
    const poor = revivePlant({ ...dead, economy: { ...dead.economy, coins: 0 } }, key, at);
    expect(poor.ok).toBe(false);
    const rich = revivePlant({ ...dead, economy: { ...dead.economy, coins: 100 } }, key, at);
    if (!rich.ok) throw new Error('revive');
    expect(rich.state.economy.coins).toBe(100 - S.reviveCost.common);
    expect(rich.state.seeds[seedId].diedAt).toBeNull();
    const [x, y] = key.split(',').map(Number);
    const cleared = digUp(dead, x, y);
    expect(cleared.seeds[seedId]).toBeUndefined();
    expect(cleared.world.tiles[key]).toBeUndefined();
    // A living plant still goes back to the tray.
    const alive = digUp(rich.state, x, y);
    expect(alive.seeds[seedId].tile).toBeNull();
  });
});

describe('fresh starts', () => {
  it('a revived plant is not lost again a moment later', () => {
    const at = T0 + (TO_ZERO + 200) * HOUR_MS;
    const dead = open(richIsland(), at).state;
    const key = Object.keys(dead.world.tiles).find((k) => dead.seeds[dead.world.tiles[k]].diedAt != null)!;
    const id = dead.world.tiles[key];
    const rich = revivePlant({ ...dead, economy: { ...dead.economy, coins: 500 } }, key, at);
    if (!rich.ok) throw new Error('revive');
    const soon = open(rich.state, at + 10 * HOUR_MS).state;
    expect(soon.seeds[id].diedAt).toBeNull();
    // Left alone again for as long as it took the first time, it dies again.
    const again = open(rich.state, at + 170 * HOUR_MS).state;
    expect(again.seeds[id].diedAt).not.toBeNull();
  });

  it('the plant a session revives and the animals that return survive the next dry days', () => {
    let s = open(richIsland(), T0 + (TO_ZERO + 150) * HOUR_MS).state;
    const base = Math.ceil((T0 + (TO_ZERO + 152) * HOUR_MS) / DAY_MS) * DAY_MS + 12 * HOUR_MS;
    for (let d = 0; d < 3; d++) s = session(s, 10, base + d * DAY_MS, d + 7).state;
    // The quest brought animals back while the drought meter is still far above their limit.
    expect(s.nature.drought).toBeGreaterThan(100);
    const back = islandResidents(s, base + 2 * DAY_MS).map((r) => r.id);
    const alive = Object.values(s.world.tiles).filter((id) => s.seeds[id].diedAt == null);
    // Two days later the island is at zero again and the meter climbs: nobody that came back is gone.
    const later = open(s, base + 4 * DAY_MS).state;
    expect(later.nature.drought).toBeGreaterThan(s.nature.drought);
    for (const id of back) expect(later.nature.away[id]).toBeUndefined();
    for (const id of alive.filter((x) => s.nature.spared[x] != null)) expect(later.seeds[id].diedAt).toBeNull();
  });

  it('the meter is capped and the fresh starts end when it is paid off', () => {
    const s = open(richIsland(), T0 + 90 * DAY_MS).state;
    expect(s.nature.drought).toBe(S.maxDroughtHours);
    let t = T0 + 91 * DAY_MS;
    let cur = s;
    for (let i = 0; i < 4; i++) cur = session(cur, 120, (t += 3 * HOUR_MS), i + 1).state;
    expect(cur.nature.drought).toBe(0);
    expect(cur.nature.spared).toEqual({});
  });
});

describe('water', () => {
  it('sinks when the island wilts and dries up in a drought', () => {
    expect(waterLevelOf(1, 0)).toBe(1);
    expect(waterLevelOf(0.1, 0)).toBeCloseTo(0.775);
    expect(waterLevelOf(0, 0)).toBeCloseTo(0.55);
    expect(waterLevelOf(0, S.waterDryHours)).toBe(0);
    const s = richIsland();
    expect(waterLevel(s, T0)).toBe(1);
    const dry = T0 + (TO_ZERO + 20) * HOUR_MS;
    const res = islandResidents(s, dry, 1);
    expect(res.find((r) => r.id === 'fish')).toMatchObject({ dry: true, present: false });
    expect(res.find((r) => r.id === 'frog')).toMatchObject({ dry: false });
  });
});

describe('comeback quest', () => {
  const lost = () => open(richIsland(), T0 + (TO_ZERO + 110) * HOUR_MS);
  const day0 = Math.ceil((T0 + (TO_ZERO + 112) * HOUR_MS) / DAY_MS) * DAY_MS + 12 * HOUR_MS;

  it('starts with the first focus day after a loss and restores half of it on the third', () => {
    let s = lost().state;
    expect(Object.keys(s.nature.away).length).toBeGreaterThanOrEqual(4);
    const r1 = session(s, 15, day0);
    expect(r1.summary.news.some((n) => n.kind === 'questStarted')).toBe(true);
    expect(r1.state.nature.revival).toMatchObject({ days: 1 });
    s = session(r1.state, 15, day0 + DAY_MS, 5).state;
    const stumpsBefore = stumps(s).length;
    const awayBefore = Object.keys(s.nature.away).length;
    const r3 = session(s, 15, day0 + 2 * DAY_MS, 6);
    expect(r3.summary.news.some((n) => n.kind === 'questDone')).toBe(true);
    expect(r3.state.nature.revival).toBeNull();
    expect(Object.keys(r3.state.nature.away).length).toBe(awayBefore - Math.ceil(awayBefore / 2));
    // One stump for the session itself, then half of the rest.
    const afterSession = Math.max(0, stumpsBefore - 1);
    expect(stumps(r3.state).length).toBe(afterSession - Math.ceil(afterSession / 2));
  });

  it('runs out after five days', () => {
    const s = session(lost().state, 15, day0).state;
    const late = open(s, day0 + (S.revivalWindowDays + 1) * DAY_MS);
    expect(late.state.nature.revival).toBeNull();
    expect(late.news.some((n) => n.kind === 'questFailed')).toBe(true);
  });
});

describe('streak landmarks', () => {
  it('a week-long streak builds the arch, losing the streak ruins it, half the streak rebuilds it', () => {
    let s = createInitialState(T0);
    let built: string[] = [];
    for (let d = 0; d < 7; d++) {
      const r = session(s, 15, T0 + d * DAY_MS + HOUR_MS, d + 1);
      s = r.state;
      built = built.concat(r.summary.news.filter((n) => n.kind === 'landmark').map((n) => n.subject));
    }
    expect(built).toEqual(['arch']);
    expect(s.nature.stock.arch).toBe(1);
    expect(s.nature.landmarks.arch).toMatchObject({ ruined: false });

    // The freeze earned along the way would save one missed day; miss five.
    const back = open(s, T0 + 12 * DAY_MS);
    expect(back.settlement.streakLost).toBe(7);
    expect(back.state.nature.landmarks.arch!.ruined).toBe(true);
    expect(back.news.some((n) => n.kind === 'ruined' && n.subject === 'arch')).toBe(true);
    expect(back.state.nature.stock.arch).toBe(1);

    s = back.state;
    const rebuilt: number[] = [];
    for (let d = 0; d < 5; d++) {
      const r = session(s, 15, T0 + (12 + d) * DAY_MS + HOUR_MS, d + 20);
      s = r.state;
      if (r.summary.news.some((n) => n.kind === 'rebuilt')) rebuilt.push(d + 1);
    }
    expect(rebuilt).toEqual([Math.ceil(7 * S.landmarkRebuildFraction)]);
    expect(s.nature.stock.arch).toBe(1);
  });

  it('a save with a running streak gets its landmarks', () => {
    const s = createInitialState(T0);
    const r = syncLandmarks({ ...s, progress: { ...s.progress, streak: 31 } }, 0, T0);
    expect(r.state.nature.stock).toMatchObject({ arch: 1, windmill: 1, lighthouse: 0 });
    expect(syncLandmarks(r.state, 0, T0).state).toBe(r.state);
  });
});

describe('marks of withered sessions', () => {
  it('a withered session leaves a twig for a day', () => {
    const s0 = startSession(createInitialState(T0), 1500, 0, T0, mulberry32(1));
    if (!s0.ok) throw new Error('start');
    const s = witherSession(s0.state, T0 + 60_000, 'gaveUp').state;
    expect(witherMarks(s, T0 + HOUR_MS)).toEqual([{ id: s.sessions[0].id, at: T0 + 60_000, reason: 'gaveUp' }]);
    expect(witherMarks(s, T0 + 25 * HOUR_MS)).toEqual([]);
  });
});

describe('what happens next', () => {
  it('lists the dangers soonest first', () => {
    const s = richIsland();
    const list = threats(s, T0 + HOUR_MS);
    expect(list.map((t) => t.kind)).toEqual(['fade', 'hide', 'leave', 'dry', 'stump']);
    expect(list[0].at).toBe(T0 + 20 * HOUR_MS);
    expect(list[1]).toMatchObject({ animalId: 'fox', at: T0 + (20 + 0.35 * 72) * HOUR_MS });
    expect(list.find((t) => t.kind === 'leave')).toMatchObject({ animalId: 'fox', at: T0 + (TO_ZERO + S.leaveAfterHours) * HOUR_MS });
    for (let i = 1; i < list.length; i++) expect(list[i].at).toBeGreaterThanOrEqual(list[i - 1].at);
  });

  it('warns about a streak only when no freeze would save it', () => {
    let s = createInitialState(T0);
    s = session(s, 15, T0).state;
    const tomorrow = T0 + DAY_MS;
    expect(threats(s, tomorrow).some((t) => t.kind === 'streak')).toBe(true);
    const safe = { ...s, progress: { ...s.progress, freezes: 1 } };
    expect(threats(safe, tomorrow).some((t) => t.kind === 'streak')).toBe(false);
    expect(threats(s, T0 + HOUR_MS).some((t) => t.kind === 'streak')).toBe(false);
  });

  it('an empty island has nothing to lose', () => {
    expect(threats(createInitialState(T0), T0 + DAY_MS)).toEqual([]);
  });
});

describe('balance', () => {
  it('a week without any focus costs two shy animals and a few plants, not the island', () => {
    const s = richIsland();
    const r = open(s, T0 + 7 * DAY_MS).state;
    expect(Object.keys(r.nature.away).sort()).toEqual(['deer', 'fox']);
    const plants = Object.keys(s.world.tiles).length;
    expect(stumps(r).length).toBeLessThanOrEqual(plants * 0.25);
  });

  it('ten minutes a day loses nothing, ever', () => {
    let s = richIsland();
    for (let d = 1; d <= 60; d++) s = session(s, 10, T0 + d * DAY_MS, d).state;
    expect(s.nature.away).toEqual({});
    expect(stumps(s)).toEqual([]);
    expect(s.nature.drought).toBe(0);
    expect(vitalityNow(s.world, T0 + 60 * DAY_MS)).toBeGreaterThan(0.9);
  });

  it('focusing every other day loses nothing either', () => {
    let s = richIsland();
    for (let d = 2; d <= 60; d += 2) s = session(s, 25, T0 + d * DAY_MS, d).state;
    expect(s.nature.away).toEqual({});
    expect(stumps(s)).toEqual([]);
  });

  it('two weeks of nothing is a real loss, but the legendary plants survive', () => {
    const s = richIsland();
    const r = open(s, T0 + 14 * DAY_MS).state;
    expect(Object.keys(r.nature.away).length).toBeGreaterThanOrEqual(10);
    expect(stumps(r).some((x) => x.rarity === 'legendary')).toBe(false);
  });
});

describe('save migration', () => {
  it('a save from before the stakes starts its drought now', () => {
    const old = JSON.parse(JSON.stringify(richIsland()));
    delete old.nature.drought;
    delete old.nature.settledAt;
    delete old.nature.bonds;
    delete old.nature.away;
    delete old.nature.family;
    delete old.nature.news;
    delete old.nature.landmarks;
    old.schemaVersion = 2;
    const later = T0 + 30 * DAY_MS;
    const up = migrate(old, later);
    expect(up.nature).toMatchObject({ spared: {}, drought: 0, settledAt: later, bonds: {}, away: {}, family: {}, news: [], revival: null });
    expect(open(up, later).news).toEqual([]);
    expect(open(up, later + (S.leaveAfterHours + 1) * HOUR_MS).news.map((n) => n.subject)).toEqual(['fox']);
  });
});
