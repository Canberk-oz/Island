import { getAnimal, waterBodies, type Resident } from '../game/nature';
import { getVisitor } from '../game/visitors';
import { hash01, hashString, mulberry32 } from '../game/rng';
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
  /** Per point: how high above the ground the actor sits there (a squirrel up a tree). */
  lifts?: number[];
  /** Per point: 1 where it bows its head while it waits (a deer drinking). */
  bows?: number[];
}

export interface Actor {
  key: string;
  id: string;
  kind: 'walk' | 'bird' | 'duck' | 'perch' | 'sleep';
  /** What it does while it waits: a rabbit nibbles. */
  idle?: 'nibble';
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

/** Where the lily pads of a water tile float (the frog lands on the first one). */
export function padSpots(l: IsoLayout, key: string): { x: number; y: number; r: number; bloom: boolean }[] {
  const { x, y } = parseTile(key);
  const sx = l.cx + ((x - y) * l.tw) / 2;
  const sy = l.cy + ((x + y) * l.th) / 2;
  const rand = mulberry32(hashString(`pads${key}`));
  const out = [];
  const n = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    out.push({
      x: sx + (rand() - 0.5) * l.tw * 0.36,
      y: sy + l.th * 0.16 + (rand() - 0.5) * l.th * 0.3,
      r: l.tw * (0.085 + rand() * 0.035),
      bloom: rand() < 0.4,
    });
  }
  return out;
}

/** Water tiles that carry lily pads (the frog's stepping stones). */
export function padTiles(terrain: Record<string, string>): Set<string> {
  return new Set(Object.keys(terrain).filter((k) => terrain[k] === 'water' && hash01(`pad${k}`) < 0.5));
}

export const EMPTY_SCENE: WildlifeScene = { actors: [], fish: null, swarms: [] };

const WALKERS: Record<string, { speed: number; wait: [number, number]; hop: number; hopsPerTile: number; scale: number }> = {
  rabbit: { speed: 1.1, wait: [1.5, 5], hop: 0.2, hopsPerTile: 2, scale: 1.1 },
  squirrel: { speed: 1.5, wait: [1, 4], hop: 0.08, hopsPerTile: 3, scale: 1.05 },
  hedgehog: { speed: 0.3, wait: [2, 6], hop: 0.015, hopsPerTile: 5, scale: 1.05 },
  fox: { speed: 0.75, wait: [2, 6], hop: 0.03, hopsPerTile: 3, scale: 1.2 },
  deer: { speed: 0.5, wait: [3, 8], hop: 0.03, hopsPerTile: 2.5, scale: 1.25 },
  frog: { speed: 2.4, wait: [3, 9], hop: 0.34, hopsPerTile: 1, scale: 1.05 },
  // A wading visitor: slow, stately, mostly standing.
  wader: { speed: 0.3, wait: [4, 10], hop: 0, hopsPerTile: 0, scale: 1.3 },
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
function makeTrack(
  points: { x: number; y: number; lift?: number; bow?: number }[],
  pxPerSec: number,
  wait: [number, number],
  rand: Rand,
): Track {
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
  const track: Track = { xs: loop.map((p) => p.x), ys: loop.map((p) => p.y), leave, arrive, period: t };
  if (loop.some((p) => p.lift)) track.lifts = loop.map((p) => p.lift ?? 0);
  if (loop.some((p) => p.bow)) track.bows = loop.map((p) => p.bow ?? 0);
  return track;
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
  /** Height above the ground from the track itself, in pixels. */
  perch: number;
  /** 1 while it waits at a point where it bows its head. */
  bow: number;
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
        return { x: ax, y: ay, moving: 0, k: 0, dir: ax >= px ? 1 : -1, dist: 0, perch: tr.lifts ? tr.lifts[i] : 0, bow: tr.bows ? tr.bows[i] : 0 };
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
        perch: tr.lifts ? tr.lifts[i] + (tr.lifts[i + 1] - tr.lifts[i]) * e : 0,
        bow: 0,
      };
    }
  }
  return { x: tr.xs[0], y: tr.ys[0], moving: 0, k: 0, dir: 1, dist: 0, perch: 0, bow: 0 };
}

/** How far above its track point an actor is right now (hops, flight arcs), in pixels. */
export function liftOf(actor: Actor, s: TrackState, tileW: number): number {
  'worklet';
  if (!s.moving) return s.perch;
  if (actor.kind === 'bird') return Math.sin(Math.PI * s.k) * Math.min(tileW * 0.9, s.dist * 0.25);
  if (actor.hop <= 0) return s.perch;
  const hops = Math.max(1, Math.round((s.dist / tileW) * actor.hopsPerTile));
  const f = s.k * hops;
  return s.perch + Math.abs(Math.sin(Math.PI * f)) * actor.hop;
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
  /** Local hour: some animals keep a schedule. */
  hour = 9,
  /** Winter: the ponds are frozen and the lily pads are gone. */
  frozen = false,
): WildlifeScene {
  if (residents.length === 0) return EMPTY_SCENE;

  const tiles = tilesInRadius(world.radius);
  const kindOf = (key: string) => {
    const seed = seeds[world.tiles[key]];
    if (!seed) return null;
    // A stump is in the way, but it is no tree to perch on and no flower to visit.
    return seed.diedAt != null ? 'stump' : getSpecies(seed.speciesId).kind;
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

  const pads = frozen ? new Set<string>() : padTiles(world.terrain);
  const frogLand = new Set([...nearWater, ...[...pads].filter((k) => isTileInRadius(parseTile(k).x, parseTile(k).y, world.radius))]);
  const treeBeside = (key: string) => {
    const { x, y } = parseTile(key);
    return STEPS.map(([dx, dy]) => tileKey(x + dx, y + dy)).find((k) => ['tree', 'pine'].includes(kindOf(k) ?? ''));
  };

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

  /** A young one walks the same route as its parent, a few steps behind. */
  const addYoung = (id: string, scale: number) => {
    const parent = actors.find((a) => a.id === id);
    if (!parent || !residents.find((r) => r.id === id)?.young) return;
    actors.push({
      ...parent,
      key: `${id}:young`,
      offset: parent.offset - 1.3,
      unit: l.unit * scale * 0.62,
      hop: parent.hop * 0.7,
    });
  };

  for (const r of residents) {
    // A daily visitor moves like one of the residents but wears its own sprite.
    const visitor = getVisitor(r.id);
    const id = visitor ? visitor.like : r.id;
    const def = getAnimal(id) ?? (visitor ? { shy: 0, nocturnal: false } : undefined);
    if (!def) continue;
    if (def.nocturnal && !night) continue;
    const rand = mulberry32(hashString(`${r.id}:${world.radius}:${Object.keys(world.tiles).length}`));
    const walker = WALKERS[id];
    const shy = visitor ? 0 : def.shy;

    if (walker) {
      const area = id === 'frog' && frogLand.size > 0 ? frogLand : id === 'wader' && nearWater.size > 0 ? nearWater : walkable;

      // The fox sleeps through the middle of the day, curled up by its log.
      if (r.id === 'fox' && hour >= 11 && hour < 15) {
        const logs = tiles.filter((t) => world.terrain[t.key] === 'log');
        const beside = logs
          .flatMap((t) => STEPS.map(([dx, dy]) => tileKey(t.x + dx, t.y + dy)))
          .filter((k) => walkable.has(k))
          .sort();
        const spot = beside[0] ?? [...walkable].sort()[0];
        if (spot) {
          const p = standOn(spot, rand);
          actors.push({
            key: 'fox:0',
            id: 'fox_sleep',
            kind: 'sleep',
            track: makeTrack([p], 1, [30, 30], rand),
            offset: 0,
            unit: l.unit * walker.scale,
            hop: 0,
            hopsPerTile: 0,
            shy,
          });
          continue;
        }
      }

      for (let i = 0; i < r.count; i++) {
        const route = wander(area, rand, id === 'frog' ? 6 : 12);
        if (!route) break;
        const points: { x: number; y: number; lift?: number; bow?: number }[] = route.map((key, step) => {
          if (id === 'frog' && pads.has(key)) {
            // Out on a lily pad.
            const pad = padSpots(l, key)[0];
            return { x: pad.x, y: pad.y };
          }
          const p = standOn(key, rand);
          // A deer lowers its head to drink where it stands by the water.
          if (id === 'deer' && nearWater.has(key)) return { ...p, bow: 1 };
          // A squirrel runs up the tree it passes.
          const tree = id === 'squirrel' && step % 2 === 1 ? treeBeside(key) : undefined;
          if (tree) {
            const top = plantTop(tree);
            return { x: top.x + l.tw * 0.04, y: top.base + l.th * 0.1, lift: (top.base - top.y) * 0.62 };
          }
          return p;
        });
        actors.push({
          key: `${r.id}:${i}`,
          id: r.id,
          kind: 'walk',
          idle: id === 'rabbit' ? 'nibble' : undefined,
          track: makeTrack(points, walker.speed * l.tw, walker.wait, rand),
          offset: rand() * 40,
          unit: l.unit * walker.scale,
          hop: walker.hop * l.unit,
          hopsPerTile: walker.hopsPerTile,
          shy,
        });
      }
      if (!visitor) addYoung(r.id, walker.scale);
      continue;
    }

    if (id === 'bird' && trees.length > 0) {
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
          key: `${r.id}:${i}`,
          id: r.id,
          kind: 'bird',
          track: makeTrack(stops, 2.6 * l.tw, [3, 9], rand),
          offset: rand() * 40,
          unit: l.unit * 1.2,
          hop: 0,
          hopsPerTile: 0,
          shy,
        });
      }
      continue;
    }

    if (id === 'owl' && trees.length > 0) {
      // The owl likes the hollow log; without one it takes a tree.
      const log = tiles.find((t) => world.terrain[t.key] === 'log');
      const onLog = log ? screen(l, log.x, log.y) : null;
      const p = onLog ? { x: onLog.sx - l.unit * 0.1, y: onLog.sy - l.unit * 0.22 } : plantTop(trees[Math.floor(rand() * trees.length)]);
      actors.push({
        key: 'owl:0',
        id: 'owl',
        kind: 'perch',
        track: makeTrack([{ x: p.x, y: p.y + l.unit * 0.1 }], 1, [30, 30], rand),
        offset: 0,
        unit: l.unit * 1.15,
        hop: 0,
        hopsPerTile: 0,
        shy,
      });
      continue;
    }

    if (id === 'duck' || id === 'fish') {
      const bodies = waterBodies(world).sort((a, b) => b.tiles.length - a.tiles.length);
      const lake = bodies[0];
      if (!lake) continue;
      if (id === 'fish') {
        const pts = lake.tiles.map((k) => {
          const { x, y } = parseTile(k);
          return screen(l, x, y);
        });
        fish = { xs: pts.map((p) => p.sx), ys: pts.map((p) => p.sy + l.th * 0.12), count: r.count, unit: l.unit * 1.05, shy };
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
          key: `${r.id}:${i}`,
          id: r.id,
          kind: 'duck',
          track: makeTrack(points, 0.32 * l.tw, [1, 4], rand),
          offset: rand() * 40,
          unit: l.unit * 1.1,
          hop: 0,
          hopsPerTile: 0,
          shy,
        });
      }
      if (!visitor) addYoung('duck', 1.1);
      continue;
    }

    if (id === 'butterfly' && flowers.length > 0) {
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
        shy,
      });
      continue;
    }

    if (id === 'bee') {
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
        shy,
      });
      continue;
    }

    if (id === 'firefly') {
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
        shy,
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
    const half = (a.id === 'deer' ? 0.55 : a.kind === 'sleep' ? 0.12 : 0.28) * a.unit;
    consider(a.kind === 'sleep' ? 'fox' : a.id, a.key, s.x, s.y - lift - half, Math.max(22, a.unit * 0.55));
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
