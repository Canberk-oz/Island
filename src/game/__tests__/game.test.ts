import { describe, expect, it } from 'vitest';
import { CONFIG, DAY_MS, HOUR_MS } from '../config';
import {
  feedWorld,
  hoursUntilFading,
  minutesToFullVitality,
  moodOf,
  vitalityNow,
  wiltAmount,
  wiltThreshold,
} from '../decay';
import { coinsForSession, maxStake, wagerPayout } from '../economy';
import {
  buyPouch,
  completeSession,
  createInitialState,
  gracesLeft,
  leaveApp,
  migrate,
  openApp,
  resolveSession,
  sessionProgress,
  setDailyGoal,
  startSession,
  witherSession,
} from '../engine';
import { luckFor, rarityOdds, rollSeed } from '../rewards';
import { hash01, mulberry32, pickWeighted } from '../rng';
import { SPECIES, getSpecies, speciesOfRarity } from '../species';
import { earnFreezes, markStreakDay, ringProgress, settleStreak, streakAtRisk } from '../streak';
import { dayIndex, dayKey, formatClock, formatMinutes, isoWeek, weekStart, weekdayOf } from '../time';
import { RARITIES, type GameState, type World } from '../types';
import {
  digUp,
  isTileInRadius,
  plantSeed,
  plantsUntilExpansion,
  tileCount,
  tilesInRadius,
  unplantedSeeds,
} from '../world';

// 2026-11-09 12:00 UTC, a Monday. All tests run with tz offset 0 unless stated.
const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);
const MIN = 60_000;

function world(partial: Partial<World> = {}): World {
  return { tiles: {}, radius: 1, vitality: 1, vitalityAt: T0, graceUntil: null, terrain: {}, ...partial };
}

/** Run a full session of `minutes` that starts at `at` and is completed on time. */
function runSession(state: GameState, minutes: number, at: number, seed = 1, stake = 0) {
  const rand = mulberry32(seed);
  const started = startSession(state, minutes * 60, stake, at, rand);
  if (!started.ok) throw new Error(started.reason);
  const res = resolveSession(started.state, at + minutes * MIN, rand);
  if (res.kind !== 'completed') throw new Error(`expected completed, got ${res.kind}`);
  return res;
}

describe('time', () => {
  it('rolls the day over at 04:00 local time', () => {
    const d = dayIndex(Date.UTC(2026, 10, 9, 12), 0);
    expect(dayKey(d)).toBe('2026-11-09');
    expect(dayIndex(Date.UTC(2026, 10, 10, 3, 59), 0)).toBe(d); // 03:59 still "yesterday"
    expect(dayIndex(Date.UTC(2026, 10, 10, 4, 0), 0)).toBe(d + 1);
  });

  it('respects the timezone offset', () => {
    // 01:00 UTC is 04:00 in UTC+3 (offset -180): already the next focus day.
    const ts = Date.UTC(2026, 10, 10, 1, 0);
    expect(dayKey(dayIndex(ts, -180))).toBe('2026-11-10');
    expect(dayKey(dayIndex(ts, 0))).toBe('2026-11-09');
  });

  it('knows weekdays and ISO weeks', () => {
    const monday = dayIndex(T0, 0);
    expect(weekdayOf(monday)).toBe(0);
    expect(weekdayOf(monday + 6)).toBe(6);
    expect(weekStart(monday + 4)).toBe(monday);
    expect(isoWeek(monday)).toBe(46);
    expect(isoWeek(dayIndex(Date.UTC(2026, 0, 1, 12), 0))).toBe(1);
    expect(isoWeek(dayIndex(Date.UTC(2027, 0, 1, 12), 0))).toBe(53);
  });

  it('formats clocks and durations', () => {
    expect(formatClock(1500)).toBe('25:00');
    expect(formatClock(59.2)).toBe('01:00');
    expect(formatClock(-3)).toBe('00:00');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(135.4)).toBe('2h 15m');
  });
});

describe('rng', () => {
  it('is deterministic and uniform enough', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 5000).toBeGreaterThan(0.47);
    expect(sum / 5000).toBeLessThan(0.53);
    expect(hash01('1,2')).toBe(hash01('1,2'));
    expect(hash01('1,2')).not.toBe(hash01('2,1'));
  });

  it('picks by weight and never picks zero-weight items', () => {
    const rand = mulberry32(7);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 6000; i++) counts[pickWeighted(['a', 'b', 'c'] as const, [3, 1, 0], rand)]++;
    expect(counts.c).toBe(0);
    expect(counts.a / counts.b).toBeGreaterThan(2.6);
    expect(counts.a / counts.b).toBeLessThan(3.4);
  });
});

describe('decay', () => {
  it('does not fade before the first completed session', () => {
    expect(vitalityNow(world(), T0 + 400 * DAY_MS)).toBe(1);
  });

  it('holds during the grace window, then fades to empty in 72 hours', () => {
    const w = feedWorld(world(), 25, true, T0);
    expect(vitalityNow(w, T0 + 19 * HOUR_MS)).toBe(1);
    expect(vitalityNow(w, T0 + 20 * HOUR_MS)).toBe(1);
    expect(vitalityNow(w, T0 + (20 + 36) * HOUR_MS)).toBeCloseTo(0.5, 6);
    expect(vitalityNow(w, T0 + (20 + 72) * HOUR_MS)).toBeCloseTo(0, 6);
    expect(hoursUntilFading(w, T0 + 5 * HOUR_MS)).toBeCloseTo(15, 6);
    expect(hoursUntilFading(w, T0 + 50 * HOUR_MS)).toBe(0);
  });

  it('is clearly visible after one missed day and complete after three', () => {
    // Focus Monday 20:00, skip Tuesday, look on Wednesday 08:00 (36h later).
    const w = feedWorld(world(), 25, true, T0);
    const oneMissed = vitalityNow(w, T0 + 36 * HOUR_MS);
    expect(oneMissed).toBeLessThan(0.8);
    expect(oneMissed).toBeGreaterThan(0.7);
    expect(vitalityNow(w, T0 + 4 * DAY_MS)).toBe(0);
  });

  it('never goes into debt: a month away equals four days away', () => {
    const w = feedWorld(world(), 25, true, T0);
    expect(vitalityNow(w, T0 + 30 * DAY_MS)).toBe(0);
    const revived = feedWorld(w, 75, true, T0 + 30 * DAY_MS);
    expect(vitalityNow(revived, T0 + 30 * DAY_MS)).toBe(1);
    expect(minutesToFullVitality(w, T0 + 30 * DAY_MS)).toBe(75);
  });

  it('a 25 minute session undoes one day of fading', () => {
    const w = feedWorld(world(), 25, true, T0);
    const later = T0 + (20 + 24) * HOUR_MS;
    const before = vitalityNow(w, later);
    expect(before).toBeCloseTo(1 - 24 / 72, 6);
    expect(vitalityNow(feedWorld(w, 25, true, later), later)).toBeCloseTo(1, 6);
  });

  it('short sessions feed the world but do not restart the grace window', () => {
    const w = feedWorld(world(), 25, true, T0);
    const later = T0 + 30 * HOUR_MS; // 10h into fading
    const fed = feedWorld(w, 5, false, later);
    expect(fed.graceUntil).toBe(w.graceUntil);
    expect(vitalityNow(fed, later)).toBeCloseTo(1 - 10 / 72 + 5 / 75, 6);
    // ...and it keeps fading right away.
    expect(vitalityNow(fed, later + 7.2 * HOUR_MS)).toBeCloseTo(1 - 10 / 72 + 5 / 75 - 0.1, 6);
    // A first-ever short session starts the clock without any grace.
    const first = feedWorld(world(), 1, false, T0);
    expect(first.graceUntil).toBe(T0);
    expect(vitalityNow(first, T0 + 36 * HOUR_MS)).toBeCloseTo(0.5, 6);
  });

  it('ignores a clock that was set backwards', () => {
    const w = feedWorld(world(), 25, true, T0);
    expect(vitalityNow(w, T0 - 10 * DAY_MS)).toBe(1);
  });

  it('is independent of how often it is observed', () => {
    const w = feedWorld(world({ vitality: 0.6 }), 10, true, T0);
    const direct = vitalityNow(w, T0 + 50 * HOUR_MS);
    // Re-anchoring the stored value at intermediate times must not change the result.
    let stepped = w;
    for (let h = 1; h <= 50; h++) {
      const t = T0 + h * HOUR_MS;
      stepped = { ...stepped, vitality: vitalityNow(stepped, t), vitalityAt: t };
    }
    expect(vitalityNow(stepped, T0 + 50 * HOUR_MS)).toBeCloseTo(direct, 9);
  });

  it('names the mood of the world', () => {
    expect(moodOf(1)).toBe('thriving');
    expect(moodOf(0.6)).toBe('thirsty');
    expect(moodOf(0.3)).toBe('wilting');
    expect(moodOf(0)).toBe('dormant');
  });

  it('wilts plants one by one, edge first, legendaries last', () => {
    for (const radius of [1, 2, 3, 4]) {
      for (const t of tilesInRadius(radius)) {
        const thr = wiltThreshold(t.key, radius, 'common');
        expect(thr).toBeGreaterThanOrEqual(0.2);
        expect(thr).toBeLessThanOrEqual(0.98);
        expect(wiltAmount(thr, 1)).toBe(0);
        expect(wiltAmount(thr, 0)).toBe(1);
        expect(wiltThreshold(t.key, radius, 'legendary')).toBeLessThanOrEqual(thr);
      }
    }
    const avg = (keys: string[]) => keys.reduce((a, k) => a + wiltThreshold(k, 3, 'common'), 0) / keys.length;
    const tiles = tilesInRadius(3);
    const inner = tiles.filter((t) => Math.hypot(t.x, t.y) <= 1.5).map((t) => t.key);
    const outer = tiles.filter((t) => Math.hypot(t.x, t.y) > 2.5).map((t) => t.key);
    expect(avg(outer)).toBeGreaterThan(avg(inner) + 0.2);
    // After one missed day some plants droop, but far from all of them.
    const wilting = tiles.filter((t) => wiltAmount(wiltThreshold(t.key, 3, 'common'), 0.72) > 0).length;
    expect(wilting).toBeGreaterThan(0);
    expect(wilting).toBeLessThan(tiles.length);
  });
});

describe('economy', () => {
  it('caps the stake by session length and by balance', () => {
    expect(maxStake(25 * 60, 1000)).toBe(50);
    expect(maxStake(25 * 60, 30)).toBe(30);
    expect(maxStake(60, 1000)).toBe(2);
    expect(maxStake(10, 1000)).toBe(0);
  });

  it('pays 1.5x back and one coin per minute', () => {
    expect(wagerPayout(40)).toBe(60);
    expect(wagerPayout(5)).toBe(7);
    expect(wagerPayout(0)).toBe(0);
    expect(coinsForSession(25 * 60)).toBe(25);
    expect(coinsForSession(59)).toBe(0);
  });
});

describe('rewards', () => {
  it('odds sum to one and longer sessions are luckier', () => {
    for (const m of [1, 10, 25, 60, 120]) {
      const o = rarityOdds(m);
      expect(RARITIES.reduce((a, r) => a + o[r], 0)).toBeCloseTo(1, 9);
    }
    expect(luckFor(25)).toBe(1);
    expect(luckFor(1)).toBe(CONFIG.rewards.luckMin);
    expect(luckFor(600)).toBe(CONFIG.rewards.luckMax);
    expect(rarityOdds(25).common).toBeCloseTo(0.7, 6);
    expect(rarityOdds(25).legendary).toBeCloseTo(0.01, 6);
    expect(rarityOdds(60).legendary).toBeGreaterThan(rarityOdds(25).legendary);
    expect(rarityOdds(60).common).toBeLessThan(rarityOdds(25).common);
  });

  it('matches the odds over many rolls', () => {
    const rand = mulberry32(2026);
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const n = 40000;
    for (let i = 0; i < n; i++) counts[rollSeed(25, 0, {}, rand).rarity]++;
    expect(counts.common / n).toBeCloseTo(0.7, 1);
    expect(counts.rare / n).toBeCloseTo(0.22, 1);
    expect(counts.epic / n).toBeGreaterThan(0.055);
    expect(counts.epic / n).toBeLessThan(0.085);
    expect(counts.legendary / n).toBeGreaterThan(0.006);
    expect(counts.legendary / n).toBeLessThan(0.015);
  });

  it('guarantees a rare-or-better seed after seven commons in a row', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      expect(rollSeed(25, CONFIG.rewards.pityAfter, {}, rand).rarity).not.toBe('common');
    }
    // The counter climbs on commons and resets otherwise; it never passes the pity limit.
    let pity = 0;
    let longestCommonRun = 0;
    let run = 0;
    for (let i = 0; i < 5000; i++) {
      const roll = rollSeed(1, pity, {}, rand);
      expect(roll.pityCounter).toBe(roll.rarity === 'common' ? pity + 1 : 0);
      run = roll.rarity === 'common' ? run + 1 : 0;
      longestCommonRun = Math.max(longestCommonRun, run);
      pity = roll.pityCounter;
    }
    expect(longestCommonRun).toBe(CONFIG.rewards.pityAfter);
  });

  it('picks a species of the rolled rarity and favours undiscovered ones', () => {
    const rand = mulberry32(11);
    const commons = speciesOfRarity('common');
    const discovered = Object.fromEntries(commons.slice(1).map((s) => [s.id, 1]));
    let fresh = 0;
    let n = 0;
    for (let i = 0; i < 20000; i++) {
      const roll = rollSeed(25, 0, discovered, rand);
      expect(getSpecies(roll.speciesId).rarity).toBe(roll.rarity);
      if (roll.rarity === 'common') {
        n++;
        if (roll.speciesId === commons[0].id) fresh++;
      }
    }
    // 2 / (2 + 4) with a bias of 2 among five commons.
    expect(fresh / n).toBeCloseTo(2 / (commons.length + 1), 1);
  });

  it('has a consistent catalogue', () => {
    const ids = new Set(SPECIES.map((s) => s.id));
    expect(ids.size).toBe(SPECIES.length);
    for (const r of RARITIES) expect(speciesOfRarity(r).length).toBeGreaterThan(0);
    expect(getSpecies('nope').id).toBe(SPECIES[0].id);
  });
});

describe('streak', () => {
  const base = createInitialState(T0).progress;
  const today = dayIndex(T0, 0);

  it('grows by one per day and is idempotent within a day', () => {
    let p = markStreakDay(base, today);
    p = markStreakDay(p, today);
    expect(p.streak).toBe(1);
    p = markStreakDay(settleStreak(p, today + 1).progress, today + 1);
    expect(p.streak).toBe(2);
    expect(p.bestStreak).toBe(2);
    expect(streakAtRisk(p, today + 1)).toBe(false);
    expect(streakAtRisk(p, today + 2)).toBe(true);
  });

  it('resets after a missed day without freezes and remembers the best', () => {
    let p = markStreakDay(markStreakDay(base, today), today + 1);
    const s = settleStreak(p, today + 3);
    expect(s.streakLost).toBe(2);
    expect(s.progress.streak).toBe(0);
    expect(s.progress.bestStreak).toBe(2);
    p = markStreakDay(s.progress, today + 3);
    expect(p.streak).toBe(1);
  });

  it('spends one freeze per missed day', () => {
    const p = { ...markStreakDay(base, today), streak: 9, freezes: 2 };
    const s = settleStreak(p, today + 3); // missed two full days
    expect(s.freezesUsed).toBe(2);
    expect(s.progress.freezes).toBe(0);
    expect(s.progress.streak).toBe(9);
    expect(s.progress.frozenDays).toEqual([dayKey(today + 1), dayKey(today + 2)]);
    // Settling again the same day changes nothing.
    expect(settleStreak(s.progress, today + 3).freezesUsed).toBe(0);
    expect(markStreakDay(s.progress, today + 3).streak).toBe(10);
  });

  it('keeps the freezes when they cannot save the streak', () => {
    const p = { ...markStreakDay(base, today), streak: 9, freezes: 2 };
    const s = settleStreak(p, today + 4); // missed three days, only two freezes
    expect(s.streakLost).toBe(9);
    expect(s.progress.freezes).toBe(2);
    expect(s.progress.streak).toBe(0);
  });

  it('earns a freeze per 120 focus minutes, capped at two', () => {
    let r = earnFreezes(base, 119);
    expect(r.earned).toBe(0);
    r = earnFreezes(r.progress, 1);
    expect(r.earned).toBe(1);
    expect(r.progress.freezes).toBe(1);
    expect(r.progress.minutesTowardFreeze).toBe(0);
    r = earnFreezes(r.progress, 500);
    expect(r.progress.freezes).toBe(2);
    expect(r.progress.minutesTowardFreeze).toBe(0);
    r = earnFreezes(r.progress, 500);
    expect(r.earned).toBe(0);
    expect(r.progress.freezes).toBe(2);
  });

  it('computes the daily ring, including extra laps', () => {
    const key = dayKey(today);
    expect(ringProgress(base, key)).toBe(0);
    expect(ringProgress({ ...base, days: { [key]: 30 } }, key)).toBe(0.5);
    expect(ringProgress({ ...base, days: { [key]: 150 } }, key)).toBe(2.5);
  });
});

describe('world', () => {
  it('is a rounded island that grows with its radius', () => {
    expect(tileCount(1)).toBe(9);
    expect(tileCount(2)).toBe(21);
    expect(tileCount(3)).toBe(37);
    expect(tileCount(4)).toBe(69);
    expect(isTileInRadius(1, 1, 1)).toBe(true);
    expect(isTileInRadius(2, 2, 2)).toBe(false);
    const tiles = tilesInRadius(2);
    for (let i = 1; i < tiles.length; i++) {
      expect(tiles[i].x + tiles[i].y).toBeGreaterThanOrEqual(tiles[i - 1].x + tiles[i - 1].y);
    }
  });

  it('plants, validates and digs up', () => {
    let state = runSession(createInitialState(T0), 25, T0).state;
    const seed = unplantedSeeds(state)[0];
    expect(plantSeed(state, 'nope', 0, 0, T0)).toEqual({ ok: false, reason: 'unknownSeed' });
    expect(plantSeed(state, seed.id, 5, 5, T0)).toEqual({ ok: false, reason: 'outOfBounds' });
    const planted = plantSeed(state, seed.id, 0, 0, T0);
    if (!planted.ok) throw new Error('should plant');
    state = planted.state;
    expect(state.world.tiles['0,0']).toBe(seed.id);
    expect(state.seeds[seed.id].tile).toBe('0,0');
    expect(unplantedSeeds(state).map((x) => x.id)).toEqual(['starter']);
    expect(plantSeed(state, seed.id, 1, 0, T0)).toEqual({ ok: false, reason: 'alreadyPlanted' });

    const second = runSession(state, 25, T0 + HOUR_MS, 2).state;
    const other = unplantedSeeds(second)[0];
    expect(plantSeed(second, other.id, 0, 0, T0)).toEqual({ ok: false, reason: 'occupied' });

    const dug = digUp(state, 0, 0);
    expect(dug.world.tiles['0,0']).toBeUndefined();
    expect(dug.seeds[seed.id].tile).toBeNull();
    expect(digUp(dug, 0, 0)).toBe(dug);
  });

  it('grows the island at 70% fill and never beyond the maximum', () => {
    let state = createInitialState(T0);
    expect(plantsUntilExpansion(state.world)).toBe(7);
    let at = T0;
    let grew = 0;
    for (let radius = 1; radius <= CONFIG.world.maxRadius; radius++) {
      for (const t of tilesInRadius(radius)) {
        if (state.world.tiles[t.key]) continue;
        state = runSession(state, 20, at, at % 9973).state;
        at += HOUR_MS;
        const seed = unplantedSeeds(state)[0];
        const res = plantSeed(state, seed.id, t.x, t.y, at);
        if (!res.ok) throw new Error(res.reason);
        if (res.islandGrew) grew++;
        state = res.state;
      }
    }
    expect(grew).toBe(CONFIG.world.maxRadius - 1);
    expect(state.world.radius).toBe(5);
    expect(Object.keys(state.world.tiles)).toHaveLength(97);
    expect(plantsUntilExpansion(state.world)).toBe(0);
  });
});

describe('session', () => {
  const fresh = () => createInitialState(T0);

  it('starts, takes the stake immediately and validates input', () => {
    const rand = mulberry32(1);
    const s = startSession(fresh(), 25 * 60, 20, T0, rand);
    if (!s.ok) throw new Error('should start');
    expect(s.state.economy.coins).toBe(0);
    expect(s.state.active?.stake).toBe(20);
    expect(startSession(s.state, 60, 0, T0, rand)).toEqual({ ok: false, reason: 'alreadyRunning' });
    expect(startSession(fresh(), 0, 0, T0, rand)).toEqual({ ok: false, reason: 'invalidDuration' });
    expect(startSession(fresh(), 25 * 60, 21, T0, rand)).toEqual({ ok: false, reason: 'invalidStake' });
    expect(startSession(fresh(), 5 * 60, 11, T0, rand)).toEqual({ ok: false, reason: 'invalidStake' });
    expect(startSession(fresh(), 25 * 60, -1, T0, rand)).toEqual({ ok: false, reason: 'invalidStake' });
    expect(startSession(fresh(), 25 * 60, 1.5, T0, rand)).toEqual({ ok: false, reason: 'invalidStake' });
  });

  it('keeps running until the time is up, then completes', () => {
    const rand = mulberry32(1);
    const s = startSession(fresh(), 60, 0, T0, rand);
    if (!s.ok) throw new Error();
    expect(sessionProgress(s.state.active!, T0 + 30_000)).toBe(0.5);
    expect(resolveSession(s.state, T0 + 59_999, rand).kind).toBe('running');
    const done = resolveSession(s.state, T0 + 60_000, rand);
    expect(done.kind).toBe('completed');
    expect(done.state.active).toBeNull();
    expect(resolveSession(done.state, T0 + 61_000, rand).kind).toBe('idle');
  });

  it('forgives a short absence, up to three times', () => {
    const rand = mulberry32(1);
    const s = startSession(fresh(), 25 * 60, 0, T0, rand);
    if (!s.ok) throw new Error();
    let state = s.state;
    let t = T0;
    for (let i = 1; i <= 3; i++) {
      t += MIN;
      state = leaveApp(state, t);
      // Leaving twice in a row keeps the first timestamp.
      expect(leaveApp(state, t + 1000).active?.leftAt).toBe(t);
      const back = resolveSession(state, t + 5000, rand, 'return');
      if (back.kind !== 'running') throw new Error(`expected running, got ${back.kind}`);
      expect(back.graceUsed).toBe(true);
      state = back.state;
      expect(state.active?.leftAt).toBeNull();
      expect(gracesLeft(state.active!)).toBe(3 - i);
    }
    // Fourth absence: withers even though it was short.
    t += MIN;
    state = leaveApp(state, t);
    const gone = resolveSession(state, t + 1000, rand, 'return');
    expect(gone.kind).toBe('withered');
  });

  it('a timer tick in the background never counts as coming back', () => {
    const rand = mulberry32(1);
    const s = startSession(fresh(), 60, 0, T0, rand);
    if (!s.ok) throw new Error();
    const left = leaveApp(s.state, T0 + 10_000);
    // Timers keep firing while the app is away: nothing may change within the grace period...
    for (const ms of [250, 1000, 3000, CONFIG.session.graceMs]) {
      const tick = resolveSession(left, T0 + 10_000 + ms, rand, 'tick');
      if (tick.kind !== 'running') throw new Error(`expected running, got ${tick.kind}`);
      expect(tick.state).toBe(left);
      expect(tick.graceUsed).toBe(false);
      expect(tick.state.active?.leftAt).toBe(T0 + 10_000);
      expect(tick.state.active?.gracesUsed).toBe(0);
    }
    // ...and once it is over the sapling withers, whether or not the player ever returns.
    const late = resolveSession(left, T0 + 10_000 + CONFIG.session.graceMs + 250, rand, 'tick');
    if (late.kind !== 'withered') throw new Error(`expected withered, got ${late.kind}`);
    expect(late.summary.session.endedAt).toBe(T0 + 10_000);
    // Even when the timer would have run out in the meantime, a tick cannot complete it while away.
    const overtime = resolveSession(leaveApp(s.state, T0 + 58_000), T0 + 61_000, rand, 'tick');
    expect(overtime.kind).toBe('running');
    expect(overtime.state.active?.leftAt).toBe(T0 + 58_000);
    // With no graces left, the first tick after leaving withers it.
    const spent = { ...s.state, active: { ...s.state.active!, gracesUsed: CONFIG.session.maxGraces } };
    expect(resolveSession(leaveApp(spent, T0 + 5000), T0 + 5250, rand, 'tick').kind).toBe('withered');
  });

  it('withers when away longer than the grace period and loses the stake', () => {
    const rand = mulberry32(1);
    const s = startSession(fresh(), 25 * 60, 20, T0, rand);
    if (!s.ok) throw new Error();
    const left = leaveApp(s.state, T0 + 5 * MIN);
    const exactly = resolveSession(left, T0 + 5 * MIN + CONFIG.session.graceMs, rand, 'return');
    expect(exactly.kind).toBe('running');
    const back = resolveSession(left, T0 + 5 * MIN + CONFIG.session.graceMs + 1, rand, 'return');
    if (back.kind !== 'withered') throw new Error();
    expect(back.summary.stakeLost).toBe(20);
    expect(back.summary.reason).toBe('left');
    expect(back.summary.session.endedAt).toBe(T0 + 5 * MIN);
    expect(back.state.economy.coins).toBe(0);
    expect(back.state.active).toBeNull();
    expect(back.state.sessions.at(-1)?.outcome).toBe('withered');
    expect(Object.keys(back.state.seeds)).toEqual(['starter']);
    expect(back.state.world.graceUntil).toBeNull();
  });

  it('withers when the app was away for days, even though the timer ran out meanwhile', () => {
    const rand = mulberry32(1);
    const s = startSession(fresh(), 25 * 60, 0, T0, rand);
    if (!s.ok) throw new Error();
    const left = leaveApp(s.state, T0 + 10 * MIN);
    expect(resolveSession(left, T0 + 3 * DAY_MS, rand, 'return').kind).toBe('withered');
    expect(resolveSession(left, T0 + 3 * DAY_MS, rand, 'tick').kind).toBe('withered');
  });

  it('completes when the timer ran out during a forgiven absence', () => {
    const rand = mulberry32(1);
    const s = startSession(fresh(), 60, 0, T0, rand);
    if (!s.ok) throw new Error();
    const left = leaveApp(s.state, T0 + 58_000);
    expect(resolveSession(left, T0 + 62_000, rand, 'return').kind).toBe('completed');
  });

  it('withers on a cold start: killed in the background or crashed in front', () => {
    const rand = mulberry32(1);
    const s = startSession(fresh(), 25 * 60, 10, T0, rand);
    if (!s.ok) throw new Error();
    const killedAway = resolveSession(leaveApp(s.state, T0 + MIN), T0 + MIN + 2000, rand, 'coldStart');
    if (killedAway.kind !== 'withered') throw new Error();
    expect(killedAway.summary.reason).toBe('left');
    const crashed = resolveSession(s.state, T0 + MIN, rand, 'coldStart');
    if (crashed.kind !== 'withered') throw new Error();
    expect(crashed.summary.reason).toBe('interrupted');
    expect(resolveSession(fresh(), T0, rand, 'coldStart').kind).toBe('idle');
  });

  it('giving up withers the session', () => {
    const rand = mulberry32(1);
    const s = startSession(fresh(), 25 * 60, 5, T0, rand);
    if (!s.ok) throw new Error();
    const r = witherSession(s.state, T0 + MIN, 'gaveUp');
    expect(r.summary.reason).toBe('gaveUp');
    expect(r.state.economy.coins).toBe(15);
    expect(() => witherSession(r.state, T0, 'gaveUp')).toThrow();
    expect(() => completeSession(r.state, T0, rand)).toThrow();
  });
});

describe('completion', () => {
  it('pays coins, the wager, a seed, the ring, the streak and the world', () => {
    const res = runSession(createInitialState(T0), 25, T0, 3, 20);
    const { state, summary } = res;
    expect(summary.coinsEarned).toBe(25);
    expect(summary.payout).toBe(30);
    expect(state.economy.coins).toBe(20 - 20 + 25 + 30);
    expect(state.economy.lifetimeFocusMin).toBe(25);
    expect(state.economy.lifetimeSessions).toBe(1);
    if (!summary.seed) throw new Error('a 25 minute session drops a seed');
    expect(state.seeds[summary.seed.id]).toEqual(summary.seed);
    expect(summary.seed.tile).toBeNull();
    expect(summary.isNewSpecies).toBe(true);
    expect(state.progress.discovered[summary.seed.speciesId]).toBe(1);
    expect(summary.streakBefore).toBe(0);
    expect(summary.streakAfter).toBe(1);
    expect(summary.qualifiedForStreak).toBe(true);
    expect(summary.ringBefore).toBe(0);
    expect(summary.ringAfter).toBeCloseTo(25 / 60, 9);
    expect(summary.ringClosedNow).toBe(false);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].seedId).toBe(summary.seed.id);
    expect(state.world.graceUntil).toBe(T0 + 25 * MIN + 20 * HOUR_MS);
  });

  it('short sessions reward a seed but neither streak nor grace', () => {
    const { state, summary } = runSession(createInitialState(T0), 1, T0);
    expect(summary.qualifiedForStreak).toBe(false);
    expect(state.progress.streak).toBe(0);
    expect(summary.coinsEarned).toBe(1);
    expect(Object.keys(state.seeds)).toHaveLength(1);
    expect(state.world.graceUntil).toBe(T0 + MIN);
  });

  it('closes the ring exactly once', () => {
    let state = setDailyGoal(createInitialState(T0), 30);
    const a = runSession(state, 15, T0);
    expect(a.summary.ringClosedNow).toBe(false);
    const b = runSession(a.state, 15, T0 + HOUR_MS, 2);
    expect(b.summary.ringClosedNow).toBe(true);
    const c = runSession(b.state, 15, T0 + 2 * HOUR_MS, 3);
    expect(c.summary.ringClosedNow).toBe(false);
    expect(c.summary.ringAfter).toBeCloseTo(1.5, 9);
    state = c.state;
    expect(state.progress.streak).toBe(1);
  });

  it('a week in the life: streak, freeze, missed days, revival', () => {
    let state = createInitialState(T0);
    // Days 0..2: two hours of focus each day earns freezes.
    for (let d = 0; d < 3; d++) {
      for (let i = 0; i < 2; i++) {
        state = runSession(state, 60, T0 + d * DAY_MS + i * 2 * HOUR_MS, d * 10 + i).state;
      }
    }
    expect(state.progress.streak).toBe(3);
    expect(state.progress.freezes).toBe(2);
    const lastFocus = T0 + 2 * DAY_MS + 3 * HOUR_MS;
    expect(vitalityNow(state.world, lastFocus)).toBe(1);

    // Day 3 is skipped. Opening the app on day 4 spends a freeze and shows a faded world.
    const day4 = T0 + 4 * DAY_MS;
    const opened = openApp(state, day4);
    expect(opened.settlement.freezesUsed).toBe(1);
    expect(opened.state.progress.streak).toBe(3);
    expect(opened.state.progress.freezes).toBe(1);
    const faded = vitalityNow(opened.state.world, day4);
    expect(faded).toBeCloseTo(1 - (45 - 20) / 72, 6);

    // One 25 minute session: streak continues and the world recovers a day of fading.
    const back = runSession(opened.state, 25, day4, 99);
    expect(back.summary.streakAfter).toBe(4);
    expect(back.summary.vitalityBefore).toBeCloseTo(faded - (25 / 60) / 72, 6);
    expect(back.summary.vitalityAfter).toBeGreaterThan(faded + 0.3);

    // Two weeks away: the streak is gone, the best streak and every plant are kept.
    const later = day4 + 14 * DAY_MS;
    const returned = openApp(back.state, later);
    expect(returned.settlement.streakLost).toBe(4);
    expect(returned.state.progress.bestStreak).toBe(4);
    expect(returned.state.progress.freezes).toBe(1);
    expect(vitalityNow(returned.state.world, later)).toBe(0);
    expect(Object.keys(returned.state.seeds)).toHaveLength(8);
    const revived = runSession(returned.state, 75, later, 5);
    expect(revived.summary.vitalityAfter).toBe(1);
    expect(revived.summary.streakAfter).toBe(1);
  });

  it('completing a session after missed days settles the streak first', () => {
    let state = runSession(createInitialState(T0), 25, T0).state;
    state = runSession(state, 25, T0 + DAY_MS, 2).state;
    expect(state.progress.streak).toBe(2);
    const res = runSession(state, 25, T0 + 5 * DAY_MS, 3);
    expect(res.summary.streakBefore).toBe(0);
    expect(res.summary.streakAfter).toBe(1);
  });

  it('caps the stored history', () => {
    let state = createInitialState(T0);
    for (let i = 0; i < CONFIG.historyCap + 20; i++) state = runSession(state, 1, T0 + i * 2 * MIN, i).state;
    expect(state.sessions).toHaveLength(CONFIG.historyCap);
    expect(state.economy.lifetimeSessions).toBe(CONFIG.historyCap + 20);
  });
});

describe('pouch, goal, migration', () => {
  it('sells a rare-or-better seed for coins', () => {
    const state = createInitialState(T0);
    expect(buyPouch(state, T0, mulberry32(1))).toEqual({ ok: false, reason: 'notEnoughCoins' });
    const rich = { ...state, economy: { ...state.economy, coins: 250 } };
    const rand = mulberry32(8);
    let current = rich;
    for (let i = 0; i < 2; i++) {
      const res = buyPouch(current, T0 + i, rand);
      if (!res.ok) throw new Error();
      expect(res.seed.rarity).not.toBe('common');
      expect(res.seed.source).toBe('pouch');
      current = res.state;
    }
    expect(current.economy.coins).toBe(50);
    expect(Object.keys(current.seeds)).toHaveLength(3);
    expect(current.progress.pityCounter).toBe(0);
  });

  it('clamps the daily goal', () => {
    const s = createInitialState(T0);
    expect(setDailyGoal(s, 5).progress.dailyGoalMin).toBe(CONFIG.ring.minGoalMin);
    expect(setDailyGoal(s, 9999).progress.dailyGoalMin).toBe(CONFIG.ring.maxGoalMin);
    expect(setDailyGoal(s, 90).progress.dailyGoalMin).toBe(90);
  });

  it('migrates missing or partial saves', () => {
    expect(migrate(null, T0)).toEqual(createInitialState(T0));
    expect(migrate('garbage', T0)).toEqual(createInitialState(T0));
    const partial = migrate({ economy: { coins: 77 }, progress: { streak: 4 }, sessions: 'x' }, T0);
    expect(partial.economy.coins).toBe(77);
    expect(partial.economy.lifetimeFocusMin).toBe(0);
    expect(partial.progress.streak).toBe(4);
    expect(partial.progress.dailyGoalMin).toBe(CONFIG.ring.defaultGoalMin);
    expect(partial.sessions).toEqual([]);
    expect(partial.world.radius).toBe(CONFIG.world.startRadius);
    const full = runSession(createInitialState(T0), 25, T0).state;
    expect(migrate(JSON.parse(JSON.stringify(full)), T0 + 5)).toEqual(full);
  });
});
