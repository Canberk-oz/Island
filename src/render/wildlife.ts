import { getAnimal, waterBodies, type Resident } from '../game/nature';
import { hashString, mulberry32 } from '../game/rng';
import { getSpecies } from '../game/species';
import type { Rand, Seed, World } from '../game/types';
import { isTileInRadius, parseTile, tileKey, tilesInRadius } from '../game/world';
import { plantSprite } from './plants';

/**
 * Where every animal is at any moment.
 *
 * Nothing here is simulated step by step. Each animal gets a looping track
 * that is laid out once (from the island as it is right now), and its
 * position is a pure function of the clock. That function runs on the UI
 * thread for drawing and on the JS thread for hit testing, and always agrees.
 */

export interface IsoLayout {
  cx: number;
  cy: number;
  tw: number;
  th: number;
  unit: number;
  halfW: number;
  halfH: number;
}

/** A closed path through points, with a pause before leaving each one. */
export interface Track {
  xs: number[];
  ys: number[];
  /** Time at which the actor leaves point i. */
  leave: number[];
  /** Time at which it arrives at point i + 1. */
  arrive: number[];
  period: number;
}

export interface Actor {
  key: string;
  id: string;
  kind: 'walk' | 'bird' | 'duck' | 'perch';
  track: Track;
  /** Seconds added to the clock so that actors do not move in step. */
  offset: number;
  /** Sprite unit in pixels. */
  unit: number;
  /** Hop height in pixels and number of hops per segment (0 = glide). */
  hop: number;
  hopsPerTile: number;
  shy: number;
}

export interface FishSchool {
  /** Centres of the water tiles the fish jump from. */
  xs: number[];
  ys: number[];
  count: number;
  unit: number;
  shy: number;
}

export interface Swarm {
  id: 'butterfly' | 'bee' | 'firefly';
  /** Points the members drift between. */
  ax: number[];
  ay: number[];
  count: number;
  radius: number;
  speed: number;
  dwell: number;
  seed: number;
  size: number;
  shy: number;
}

export interface WildlifeScene {
  actors: Actor[];
  fish: FishSchool | null;
  swarms: Swarm[];
}

export const EMPTY_SCENE: WildlifeScene = { actors: [], fish: null, swarms: [] };

const WALKERS: Record<string, { speed: number; wait: [number, number]; hop: number; hopsPerTile: number; scale: number }> = {
  rabbit: { speed: 1.1, wait: [1.5, 5], hop: 0.2, hopsPerTile: 2, scale: 1.1 },
  squirrel: { speed: 1.5, wait: [1, 4], hop: 0.08, hopsPerTile: 3, scale: 1.05 },
  hedgehog: { speed: 0.3, wait: [2, 6], hop: 0.015, hopsPerTile: 5, scale: 1.05 },
  fox: { speed: 0.75, wait: [2, 6], hop: 0.03, hopsPerTile: 3, scale: 1.2 },
  deer: { speed: 0.5, wait: [3, 8], hop: 0.03, hopsPerTile: 2.5, scale: 1.25 },
  frog: { speed: 2.4, wait: [3, 9], hop: 0.34, hopsPerTile: 1, scale: 1.05 },
};

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function between(rand: Rand, [lo, hi]: [number, number]) {
  return lo + rand() * (hi - lo);
}

function screen(l: IsoLayout, x: number, y: number) {
  return { sx: l.cx + ((x - y) * l.tw) / 2, sy: l.cy + ((x + y) * l.th) / 2 };
}

/** Turn a list of points into a closed, timed track (there and back again). */
function makeTrack(points: { x: number; y: number }[], pxPerSec: number, wait: [number, number], rand: Rand): Track {
  const loop = points.length > 1 ? [...points, ...points.slice(1, -1).reverse(), points[0]] : [points[0], points[0]];
  const leave: number[] = [];
  const arrive: number[] = [];
  let t = 0;
  for (let i = 0; i < loop.length - 1; i++) {
    t += between(rand, wait);
    leave.push(t);
    const d = Math.hypot(loop[i + 1].x - loop[i].x, loop[i + 1].y - loop[i].y);
    t += Math.max(0.3, d / Math.max(1, pxPerSec));
    arrive.push(t);
  }
  return { xs: loop.map((p) => p.x), ys: loop.map((p) => p.y), leave, arrive, period: t };
}

export interface TrackState {
  x: number;
  y: number;
  /** 1 while travelling between two points. */
  moving: number;
  /** Progress of the current move, 0..1. */
  k: number;
  /** 1 facing right, -1 facing left. */
  dir: number;
  /** Length of the current segment in pixels. */
  dist: number;
}

export function trackAt(tr: Track, time: number): TrackState {
  'worklet';
  const tt = ((time % tr.period) + tr.period) % tr.period;
  const n = tr.leave.length;
  for (let i = 0; i < n; i++) {
    if (tt < tr.arrive[i]) {
      const ax = tr.xs[i];
      const ay = tr.ys[i];
      const bx = tr.xs[i + 1];
      const by = tr.ys[i + 1];
      if (tt <= tr.leave[i]) {
        // Waiting: keep looking the way it came from.
        const px = tr.xs[i === 0 ? n - 1 : i - 1];
        return { x: ax, y: ay, moving: 0, k: 0, dir: ax >= px ? 1 : -1, dist: 0 };
      }
      const k = (tt - tr.leave[i]) / (tr.arrive[i] - tr.leave[i]);
      const e = k * k * (3 - 2 * k);
      return {
        x: ax + (bx - ax) * e,
        y: ay + (by - ay) * e,
        moving: 1,
        k,
        dir: bx >= ax ? 1 : -1,
        dist: Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)),
      };
    }
  }
  return { x: tr.xs[0], y: tr.ys[0], moving: 0, k: 0, dir: 1, dist: 0 };
}

/** How far above its track point an actor is right now (hops, flight arcs), in pixels. */
export function liftOf(actor: Actor, s: TrackState, tileW: number): number {
  'worklet';
  if (!s.moving) return 0;
  if (actor.kind === 'bird') return Math.sin(Math.PI * s.k) * Math.min(tileW * 0.9, s.dist * 0.25);
  if (actor.hop <= 0) return 0;
  const hops = Math.max(1, Math.round((s.dist / tileW) * actor.hopsPerTile));
  const f = s.k * hops;
  return Math.abs(Math.sin(Math.PI * f)) * actor.hop;
}

export function swarmAt(sw: Swarm, i: number, time: number) {
  'worklet';
  const n = sw.ax.length;
  const s = sw.seed + i * 12.9898;
  const tt = time / sw.dwell + i * 0.37 + sw.seed;
  const idx = Math.floor(tt);
  const f = tt - idx;
  const a = (((idx * 7 + i * 3) % n) + n) % n;
  const b = ((((idx + 1) * 7 + i * 3) % n) + n) % n;
  const g = f < 0.7 ? 0 : (f - 0.7) / 0.3;
  const e = g * g * (3 - 2 * g);
  const cx = sw.ax[a] + (sw.ax[b] - sw.ax[a]) * e;
  const cy = sw.ay[a] + (sw.ay[b] - sw.ay[a]) * e;
  const w = time * sw.speed;
  return {
    x: cx + Math.sin(w + s) * sw.radius + Math.sin(w * 2.3 + s * 2) * sw.radius * 0.4,
    y: cy + Math.cos(w * 1.3 + s * 1.7) * sw.radius * 0.6,
  };
}

export const FISH_PERIOD = 7;
export const FISH_JUMP = 0.8;

/** Where fish i is in its cycle: which tile it uses and how far into the cycle it is (seconds). */
export function fishCycle(school: FishSchool, i: number, time: number) {
  'worklet';
  const period = FISH_PERIOD + i * 1.9;
  const tt = time + i * 3.3 + 1.5;
  const cycle = Math.floor(tt / period);
  const n = school.xs.length;
  const tile = (((cycle * 5 + i * 3) % n) + n) % n;
  return { tile, f: tt - cycle * period, flip: (cycle + i) % 2 === 0 ? 1 : -1 };
}

// ---------------------------------------------------------------------------
// Laying out the scene
// ---------------------------------------------------------------------------

/** Build the tracks of every animal that is out on the island right now. */
export function buildWildlife(
  l: IsoLayout,
  world: Pick<World, 'tiles' | 'terrain' | 'radius'>,
  seeds: Record<string, Seed>,
  residents: Resident[],
  night: boolean,
): WildlifeScene {
  if (residents.length === 0) return EMPTY_SCENE;

  const tiles = tilesInRadius(world.radius);
  const kindOf = (key: string) => {
    const seed = seeds[world.tiles[key]];
    return seed ? getSpecies(seed.speciesId).kind : null;
  };
  const isWater = (key: string) => world.terrain[key] === 'water';
  const lowPlant = (key: string) => {
    const k = kindOf(key);
    return k === 'flower' || k === 'fern' || k === 'mushroom';
  };
  const walkable = new Set(
    tiles.filter((t) => !world.terrain[t.key] && (!world.tiles[t.key] || lowPlant(t.key))).map((t) => t.key),
  );
  const nearWater = new Set(
    [...walkable].filter((key) => {
      const { x, y } = parseTile(key);
      return STEPS.some(([dx, dy]) => isWater(tileKey(x + dx, y + dy)));
    }),
  );

  const plantTop = (key: string) => {
    const { x, y } = parseTile(key);
    const { sx, sy } = screen(l, x, y);
    const seed = seeds[world.tiles[key]];
    const h = plantSprite(seed.speciesId, l.unit).height;
    return { x: sx, y: sy - h * 0.8, base: sy };
  };
  const trees = tiles.filter((t) => ['tree', 'pine'].includes(kindOf(t.key) ?? '')).map((t) => t.key);
  const flowers = tiles.filter((t) => kindOf(t.key) === 'flower').map((t) => t.key);

  const standOn = (key: string, rand: Rand) => {
    const { x, y } = parseTile(key);
    const { sx, sy } = screen(l, x, y);
    // Stand beside a plant rather than inside it.
    const side = world.tiles[key] ? (rand() < 0.5 ? -1 : 1) * l.tw * 0.24 : (rand() - 0.5) * l.tw * 0.22;
    return { x: sx + side, y: sy + l.th * 0.1 + (rand() - 0.5) * l.th * 0.14 };
  };

  const wander = (allowed: Set<string>, rand: Rand, steps: number) => {
    const pool = [...allowed].sort();
    if (pool.length === 0) return null;
    let key = pool[Math.floor(rand() * pool.length)];
    const route = [key];
    let prev = '';
    for (let i = 0; i < steps; i++) {
      const { x, y } = parseTile(key);
      const options = STEPS.map(([dx, dy]) => tileKey(x + dx, y + dy)).filter((k) => allowed.has(k));
      if (options.length === 0) break;
      const fresh = options.filter((k) => k !== prev);
      const next = (fresh.length ? fresh : options)[Math.floor(rand() * (fresh.length ? fresh.length : options.length))];
      prev = key;
      key = next;
      route.push(key);
    }
    return route;
  };

  const actors: Actor[] = [];
  const swarms: Swarm[] = [];
  let fish: FishSchool | null = null;

  for (const r of residents) {
    const def = getAnimal(r.id);
    if (!def) continue;
    if (def.nocturnal && !night) continue;
    const rand = mulberry32(hashString(`${r.id}:${world.radius}:${Object.keys(world.tiles).length}`));
    const walker = WALKERS[r.id];

    if (walker) {
      const area = r.id === 'frog' && nearWater.size > 0 ? nearWater : walkable;
      for (let i = 0; i < r.count; i++) {
        const route = wander(area, rand, r.id === 'frog' ? 6 : 12);
        if (!route) break;
        const points = route.map((key) => standOn(key, rand));
        actors.push({
          key: `${r.id}:${i}`,
          id: r.id,
          kind: 'walk',
          track: makeTrack(points, walker.speed * l.tw, walker.wait, rand),
          offset: rand() * 40,
          unit: l.unit * walker.scale,
          hop: walker.hop * l.unit,
          hopsPerTile: walker.hopsPerTile,
          shy: def.shy,
        });
      }
      continue;
    }

    if (r.id === 'bird' && trees.length > 0) {
      const perches = trees.map(plantTop);
      // With a single tree, birds fly out over the sea and come back.
      const sky = [
        { x: l.cx - l.halfW * 1.5, y: l.cy - l.halfH * 2.6, base: 0 },
        { x: l.cx + l.halfW * 1.5, y: l.cy - l.halfH * 2.2, base: 0 },
      ];
      for (let i = 0; i < r.count; i++) {
        const stops: { x: number; y: number }[] = [];
        let last = -1;
        for (let k = 0; k < 6; k++) {
          let pick = Math.floor(rand() * perches.length);
          if (perches.length > 1 && pick === last) pick = (pick + 1) % perches.length;
          last = pick;
          const p = perches[pick];
          stops.push({ x: p.x + (rand() - 0.5) * l.tw * 0.3, y: p.y + (rand() - 0.5) * l.th * 0.3 });
          if (perches.length === 1) stops.push(sky[k % 2]);
        }
        actors.push({
          key: `bird:${i}`,
          id: 'bird',
          kind: 'bird',
          track: makeTrack(stops, 2.6 * l.tw, [3, 9], rand),
          offset: rand() * 40,
          unit: l.unit * 1.2,
          hop: 0,
          hopsPerTile: 0,
          shy: def.shy,
        });
      }
      continue;
    }

    if (r.id === 'owl' && trees.length > 0) {
      const p = plantTop(trees[Math.floor(rand() * trees.length)]);
      actors.push({
        key: 'owl:0',
        id: 'owl',
        kind: 'perch',
        track: makeTrack([{ x: p.x, y: p.y + l.unit * 0.1 }], 1, [30, 30], rand),
        offset: 0,
        unit: l.unit * 1.15,
        hop: 0,
        hopsPerTile: 0,
        shy: def.shy,
      });
      continue;
    }

    if (r.id === 'duck' || r.id === 'fish') {
      const bodies = waterBodies(world).sort((a, b) => b.tiles.length - a.tiles.length);
      const lake = bodies[0];
      if (!lake) continue;
      if (r.id === 'fish') {
        const pts = lake.tiles.map((k) => {
          const { x, y } = parseTile(k);
          return screen(l, x, y);
        });
        fish = { xs: pts.map((p) => p.sx), ys: pts.map((p) => p.sy + l.th * 0.12), count: r.count, unit: l.unit * 1.05, shy: def.shy };
        continue;
      }
      const water = new Set(lake.tiles);
      for (let i = 0; i < r.count; i++) {
        const route = wander(water, rand, 8);
        if (!route) break;
        const points = route.map((key) => {
          const { x, y } = parseTile(key);
          const { sx, sy } = screen(l, x, y);
          return { x: sx + (rand() - 0.5) * l.tw * 0.3, y: sy + l.th * 0.14 + (rand() - 0.5) * l.th * 0.2 };
        });
        actors.push({
          key: `duck:${i}`,
          id: 'duck',
          kind: 'duck',
          track: makeTrack(points, 0.32 * l.tw, [1, 4], rand),
          offset: rand() * 40,
          unit: l.unit * 1.1,
          hop: 0,
          hopsPerTile: 0,
          shy: def.shy,
        });
      }
      continue;
    }

    if (r.id === 'butterfly' && flowers.length > 0) {
      const tops = flowers.map(plantTop);
      swarms.push({
        id: 'butterfly',
        ax: tops.map((p) => p.x),
        ay: tops.map((p) => p.y - l.unit * 0.1),
        count: r.count,
        radius: l.tw * 0.22,
        speed: 1.6,
        dwell: 6,
        seed: rand() * 10,
        size: l.unit * 0.14,
        shy: def.shy,
      });
      continue;
    }

    if (r.id === 'bee') {
      const hives = tiles.filter((t) => world.terrain[t.key] === 'hive');
      const tops = flowers.map(plantTop);
      const anchors = [
        ...hives.map((t) => {
          const { sx, sy } = screen(l, t.x, t.y);
          return { x: sx, y: sy - l.unit * 0.4 };
        }),
        ...tops,
      ];
      if (anchors.length === 0) continue;
      swarms.push({
        id: 'bee',
        ax: anchors.map((p) => p.x),
        ay: anchors.map((p) => p.y),
        count: r.count,
        radius: l.tw * 0.14,
        speed: 3.4,
        dwell: 4,
        seed: rand() * 10,
        size: l.unit * 0.06,
        shy: def.shy,
      });
      continue;
    }

    if (r.id === 'firefly') {
      const spots = tiles
        .filter((t) => isWater(t.key) || world.tiles[t.key])
        .map((t) => {
          const { sx, sy } = screen(l, t.x, t.y);
          return { x: sx, y: sy - l.unit * (0.5 + rand() * 0.6) };
        });
      if (spots.length === 0) continue;
      swarms.push({
        id: 'firefly',
        ax: spots.map((p) => p.x),
        ay: spots.map((p) => p.y),
        count: r.count,
        radius: l.tw * 0.3,
        speed: 0.7,
        dwell: 9,
        seed: rand() * 10,
        size: l.unit * 0.055,
        shy: def.shy,
      });
    }
  }

  return { actors, fish, swarms };
}

export interface WildlifeHit {
  id: string;
  key: string;
  x: number;
  y: number;
}

/**
 * Which animal is under a point at a given clock time (in seconds).
 * Only animals that are out (not hiding from a wilted island) can be hit.
 */
export function hitWildlife(scene: WildlifeScene, time: number, px: number, py: number, vitality: number, l: IsoLayout): WildlifeHit | null {
  let best: WildlifeHit | null = null;
  let bestD = Infinity;
  const consider = (id: string, key: string, x: number, y: number, reach: number) => {
    const d = Math.hypot(px - x, py - y);
    if (d <= reach && d < bestD) {
      bestD = d;
      best = { id, key, x, y };
    }
  };
  for (const a of scene.actors) {
    if (vitality < a.shy) continue;
    const s = trackAt(a.track, time + a.offset);
    const lift = liftOf(a, s, l.tw);
    const half = (a.id === 'deer' ? 0.55 : 0.28) * a.unit;
    consider(a.id, a.key, s.x, s.y - lift - half, Math.max(22, a.unit * 0.55));
  }
  for (const sw of scene.swarms) {
    if (vitality < sw.shy) continue;
    for (let i = 0; i < sw.count; i++) {
      const p = swarmAt(sw, i, time);
      consider(sw.id, `${sw.id}:${i}`, p.x, p.y, 20);
    }
  }
  return best;
}

/** True when the tile is water that fish live in. */
export function fishTileAt(scene: WildlifeScene, x: number, y: number, vitality: number, l: IsoLayout): boolean {
  if (!scene.fish || vitality < scene.fish.shy) return false;
  return scene.fish.xs.some((fx, i) => Math.abs(fx - x) < l.tw * 0.5 && Math.abs(scene.fish!.ys[i] - y) < l.th * 0.5);
}

export { isTileInRadius };
