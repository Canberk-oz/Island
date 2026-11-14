import { describe, expect, it } from 'vitest';
import { atmosphereAt, celestialAt, dayPhase, daylight, hourAt, seasonAt, shadowAt, weatherAt } from '../atmosphere';
import { DAY_MS, HOUR_MS } from '../config';
import { createInitialState } from '../engine';
import { digUp, growthStage, daysToNextGrowth, plantSeed } from '../world';

const UTC = 0;
const at = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h);

describe('time of day', () => {
  it('reads the local hour with the time zone', () => {
    expect(hourAt(at(2026, 6, 1, 13) + 30 * 60_000, UTC)).toBe(13.5);
    expect(hourAt(at(2026, 6, 1, 1), 180)).toBe(22);
  });

  it('walks through dawn, day, golden hour, dusk and night', () => {
    expect([3, 6, 12, 17, 19, 22].map(dayPhase)).toEqual(['night', 'dawn', 'day', 'golden', 'dusk', 'night']);
    expect(daylight(12)).toBe(1);
    expect(daylight(2)).toBe(0);
    expect(daylight(6)).toBeGreaterThan(0);
    expect(daylight(6)).toBeLessThan(1);
  });

  it('moves the sun from left to right, highest at midday, and hands over to the moon', () => {
    const morning = celestialAt(7);
    const noon = celestialAt(12.75);
    const evening = celestialAt(19);
    expect(morning.sun && noon.sun && evening.sun).toBe(true);
    expect(morning.x).toBeLessThan(noon.x);
    expect(noon.x).toBeLessThan(evening.x);
    expect(noon.height).toBeCloseTo(1, 2);
    expect(celestialAt(23).sun).toBe(false);
    expect(celestialAt(2).x).toBeGreaterThan(celestialAt(23).x);
  });

  it('throws long shadows in the evening and short ones at noon', () => {
    expect(shadowAt(19).length).toBeGreaterThan(shadowAt(12.75).length * 1.8);
    expect(shadowAt(7).dx).toBeGreaterThan(0);
    expect(shadowAt(19).dx).toBeLessThan(0);
    expect(shadowAt(12, 'rain').strength).toBeLessThan(shadowAt(12, 'clear').strength);
  });
});

describe('seasons', () => {
  it('follow the calendar, mirrored in the south', () => {
    expect([1, 4, 7, 10].map((m) => seasonAt(at(2026, m, 15), false, UTC))).toEqual(['winter', 'spring', 'summer', 'autumn']);
    expect([1, 4, 7, 10].map((m) => seasonAt(at(2026, m, 15), true, UTC))).toEqual(['summer', 'autumn', 'winter', 'spring']);
    expect(seasonAt(at(2026, 12, 1), false, UTC)).toBe('winter');
    expect(seasonAt(at(2026, 3, 1), false, UTC)).toBe('spring');
  });
});

describe('weather', () => {
  it('tells how the island is doing', () => {
    expect(weatherAt(at(2026, 6, 1), 0.1, 'summer', UTC)).toBe('fog');
    expect(weatherAt(at(2026, 6, 1), 0.4, 'summer', UTC)).toBe('haze');
    expect(['clear', 'rain', 'rainbow']).toContain(weatherAt(at(2026, 6, 1), 0.9, 'summer', UTC));
  });

  it('a healthy island is mostly clear, with showers, rainbows after them and snow in winter', () => {
    const count: Record<string, number> = {};
    const winter: Record<string, number> = {};
    for (let h = 0; h < 24 * 120; h++) {
      const w = weatherAt(at(2026, 4, 1, 0) + h * HOUR_MS, 1, 'spring', UTC);
      count[w] = (count[w] ?? 0) + 1;
      const x = weatherAt(at(2026, 4, 1, 0) + h * HOUR_MS, 1, 'winter', UTC);
      winter[x] = (winter[x] ?? 0) + 1;
    }
    const total = 24 * 120;
    expect(count.clear / total).toBeGreaterThan(0.7);
    expect(count.rain / total).toBeGreaterThan(0.08);
    expect(count.rain / total).toBeLessThan(0.3);
    expect(count.rainbow).toBeGreaterThan(0);
    expect(count.snow).toBeUndefined();
    expect(winter.snow).toBeGreaterThan(0);
    expect(winter.rain).toBeUndefined();
    expect(winter.rainbow).toBeUndefined();
  });

  it('is stable within a shower and the same for the same moment', () => {
    const t = at(2026, 5, 3, 9);
    expect(weatherAt(t, 1, 'spring', UTC)).toBe(weatherAt(t, 1, 'spring', UTC));
    const a = atmosphereAt(t, 1, { tzOffsetMin: UTC });
    expect(a).toMatchObject({ hour: 9, phase: 'day', season: 'spring', night: false });
    expect(atmosphereAt(t, 1, { tzOffsetMin: UTC, season: 'winter' }).season).toBe('winter');
  });
});

describe('plants growing up', () => {
  const T0 = at(2026, 5, 1);
  it('goes from sprout to ancient with age', () => {
    expect(growthStage(T0, T0)).toBe(0);
    expect(growthStage(T0, T0 + 25 * HOUR_MS)).toBe(1);
    expect(growthStage(T0, T0 + 5 * DAY_MS)).toBe(2);
    expect(growthStage(T0, T0 + 31 * DAY_MS)).toBe(3);
    expect(daysToNextGrowth(T0, T0 + 12 * HOUR_MS)).toBeCloseTo(0.5);
    expect(daysToNextGrowth(T0, T0 + 40 * DAY_MS)).toBe(0);
  });

  it('a plant that is moved keeps its age', () => {
    let s = createInitialState(T0);
    s = { ...s, seeds: { a: { id: 'a', speciesId: 'tulip', rarity: 'common', earnedAt: T0, source: 'session', tile: null, plantedAt: null } } };
    const planted = plantSeed(s, 'a', 0, 0, T0);
    if (!planted.ok) throw new Error('plant');
    const moved = plantSeed(digUp(planted.state, 0, 0), 'a', 1, 0, T0 + 10 * DAY_MS);
    if (!moved.ok) throw new Error('move');
    expect(moved.state.seeds.a.plantedAt).toBe(T0);
    expect(growthStage(moved.state.seeds.a.plantedAt, T0 + 10 * DAY_MS)).toBe(2);
  });
});
