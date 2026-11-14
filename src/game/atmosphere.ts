import { clamp01, hash01 } from './rng';

/**
 * The world around the island: time of day, season and weather. All of it is
 * a pure function of the clock and the island's vitality, so the picture and
 * the sound always agree and nothing has to be stored.
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Weather = 'clear' | 'rain' | 'rainbow' | 'snow' | 'haze' | 'fog';
export type DayPhase = 'night' | 'dawn' | 'day' | 'golden' | 'dusk';

export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Local hour of the day as a fraction (13.5 = half past one). */
export function hourAt(ts: number, tzOffsetMin: number = new Date(ts).getTimezoneOffset()): number {
  const local = ts - tzOffsetMin * 60_000;
  return (((local % 86_400_000) + 86_400_000) % 86_400_000) / 3_600_000;
}

/** Meteorological seasons: spring is March to May (September to November in the south). */
export function seasonAt(ts: number, south = false, tzOffsetMin: number = new Date(ts).getTimezoneOffset()): Season {
  const month = new Date(ts - tzOffsetMin * 60_000).getUTCMonth();
  const index = Math.floor(((month + 10) % 12) / 3);
  return SEASONS[(index + (south ? 2 : 0)) % 4];
}

export function dayPhase(hour: number): DayPhase {
  if (hour >= 5 && hour < 7.5) return 'dawn';
  if (hour >= 7.5 && hour < 16.5) return 'day';
  if (hour >= 16.5 && hour < 18.5) return 'golden';
  if (hour >= 18.5 && hour < 20.5) return 'dusk';
  return 'night';
}

export function isNight(hour: number): boolean {
  return dayPhase(hour) === 'night';
}

const SUNRISE = 5.5;
const SUNSET = 20;

export interface Celestial {
  /** True for the sun, false for the moon. */
  sun: boolean;
  /** Position across the sky, 0 (left) .. 1 (right). */
  x: number;
  /** Height above the horizon, 0 .. 1 (1 at the top of the arc). */
  height: number;
}

/** Where the sun (by day) or the moon (by night) stands. */
export function celestialAt(hour: number): Celestial {
  if (hour >= SUNRISE && hour < SUNSET) {
    const f = (hour - SUNRISE) / (SUNSET - SUNRISE);
    return { sun: true, x: f, height: Math.sin(Math.PI * f) };
  }
  const night = 24 - SUNSET + SUNRISE;
  const f = ((hour - SUNSET + 24) % 24) / night;
  return { sun: false, x: f, height: Math.sin(Math.PI * f) };
}

export interface Shadow {
  /** Direction and reach along the ground: positive falls to the right. */
  dx: number;
  /** 1 at noon, longer toward sunrise and sunset. */
  length: number;
  /** Opacity factor: shadows are faint at night and under an overcast sky. */
  strength: number;
}

export function shadowAt(hour: number, weather: Weather = 'clear'): Shadow {
  const c = celestialAt(hour);
  const side = 1 - 2 * c.x;
  const low = 1 - c.height;
  const overcast = weather === 'clear' || weather === 'rainbow' ? 1 : 0.45;
  return {
    dx: side * (0.25 + 0.75 * low),
    length: 1 + 1.7 * low * low,
    strength: (c.sun ? 1 : 0.4) * overcast,
  };
}

const BLOCK_MS = 3 * 3_600_000;

function showers(block: number, season: Season): boolean {
  const chance = season === 'summer' ? 0.12 : season === 'winter' ? 0.2 : 0.18;
  return hash01(`w${block}`) < chance;
}

/**
 * The weather right now. A healthy island gets fair weather with the odd
 * shower (snow in winter) and a rainbow after it; a wilting island sits under
 * haze, and a wilted one in fog. The sky tells how the island is doing.
 */
export function weatherAt(ts: number, vitality: number, season: Season, tzOffsetMin?: number): Weather {
  if (vitality < 0.2) return 'fog';
  if (vitality < 0.5) return 'haze';
  const block = Math.floor(ts / BLOCK_MS);
  if (showers(block, season)) return season === 'winter' ? 'snow' : 'rain';
  const hour = hourAt(ts, tzOffsetMin);
  const sunUp = hour > SUNRISE + 1 && hour < SUNSET - 1;
  // The first hour after a shower, while the sun is up.
  if (season !== 'winter' && sunUp && showers(block - 1, season) && ts - block * BLOCK_MS < 3_600_000) return 'rainbow';
  return 'clear';
}

/** How much daylight there is, 0 (night) .. 1 (day), with soft edges at dawn and dusk. */
export function daylight(hour: number): number {
  if (hour < 12) return clamp01((hour - 4.5) / 2.5);
  return clamp01((20.5 - hour) / 2.5);
}

export interface Atmosphere {
  hour: number;
  phase: DayPhase;
  night: boolean;
  season: Season;
  weather: Weather;
  celestial: Celestial;
  shadow: Shadow;
  daylight: number;
}

export function atmosphereAt(
  ts: number,
  vitality: number,
  opts: { south?: boolean; season?: Season | null; tzOffsetMin?: number } = {},
): Atmosphere {
  const hour = hourAt(ts, opts.tzOffsetMin);
  const season = opts.season ?? seasonAt(ts, opts.south, opts.tzOffsetMin);
  const weather = weatherAt(ts, vitality, season, opts.tzOffsetMin);
  return {
    hour,
    phase: dayPhase(hour),
    night: isNight(hour),
    season,
    weather,
    celestial: celestialAt(hour),
    shadow: shadowAt(hour, weather),
    daylight: daylight(hour),
  };
}
