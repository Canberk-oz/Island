import { BlurMask, Group, Oval, Path, Skia, interpolateColors } from '@shopify/react-native-skia';
import type { Atmosphere, Season, Shadow } from '../game/atmosphere';
import React, { useEffect, useMemo } from 'react';
import { useDerivedValue, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { CONFIG } from '../game/config';
import { wiltThreshold } from '../game/decay';
import { hash01, hashString, mulberry32 } from '../game/rng';
import { getSpecies } from '../game/species';
import type { Seed, TerrainKind, World } from '../game/types';
import { growthStage, isTileInRadius, parseTile, tilesInRadius } from '../game/world';
import { motion } from '../ui/theme';
import { PlantBody, PlantGlow } from './PlantSprite';
import { NO_POKE, Wildlife, type Poke } from './Wildlife';
import { remainsSprite, terrainSprite } from './creatures';
import { plantSprite } from './plants';
import { EMPTY_SCENE, padSpots, padTiles, type WildlifeScene } from './wildlife';

export interface IslandLayout {
  cx: number;
  cy: number;
  /** Tile width and height on screen (2:1 isometric diamonds). */
  tw: number;
  th: number;
  /** Thickness of the earth below the grass. */
  depth: number;
  /** Pixels per plant size unit. */
  unit: number;
  halfW: number;
  halfH: number;
}

/** Fit an island of the given radius into a box centred on (cx, cy). */
export function layoutIsland(radius: number, cx: number, cy: number, availW: number, availH: number): IslandLayout {
  const spanTiles = Math.SQRT2 * (radius + 0.5) + 1;
  const tw = Math.min((availW * 0.94) / spanTiles, (availH * 0.62 * 2) / spanTiles, 92);
  const th = tw / 2;
  return {
    cx,
    cy,
    tw,
    th,
    depth: tw * 0.34,
    unit: tw * 0.56,
    halfW: (spanTiles * tw) / 2,
    halfH: (spanTiles * th) / 2,
  };
}

export function tileToScreen(l: IslandLayout, x: number, y: number) {
  return { sx: l.cx + ((x - y) * l.tw) / 2, sy: l.cy + ((x + y) * l.th) / 2 };
}

/** Which tile is under a point (or null when it is off the island). */
export function screenToTile(l: IslandLayout, px: number, py: number, radius: number) {
  const u = (px - l.cx) / (l.tw / 2);
  const v = (py - l.cy) / (l.th / 2);
  const x = Math.round((u + v) / 2);
  const y = Math.round((v - u) / 2);
  return isTileInRadius(x, y, radius) ? { x, y } : null;
}

function diamond(b: ReturnType<typeof Skia.PathBuilder.Make>, sx: number, sy: number, tw: number, th: number, inset = 0) {
  const hw = tw / 2 - inset * 2;
  const hh = th / 2 - inset;
  b.moveTo(sx, sy - hh).lineTo(sx + hw, sy).lineTo(sx, sy + hh).lineTo(sx - hw, sy).close();
}

function buildGround(l: IslandLayout, radius: number) {
  const tiles = tilesInRadius(radius);
  const topA = Skia.PathBuilder.Make();
  const topB = Skia.PathBuilder.Make();
  const left = Skia.PathBuilder.Make();
  const right = Skia.PathBuilder.Make();
  const lip = Skia.PathBuilder.Make();
  const d = l.depth;
  const lipH = d * 0.26;
  for (const t of tiles) {
    const { sx, sy } = tileToScreen(l, t.x, t.y);
    // Draw the tops a hair too big so no seams show between tiles.
    diamond((t.x + t.y) % 2 === 0 ? topA : topB, sx, sy, l.tw + 0.8, l.th + 0.4);
    if (!isTileInRadius(t.x, t.y + 1, radius)) {
      left.moveTo(sx - l.tw / 2, sy).lineTo(sx, sy + l.th / 2).lineTo(sx, sy + l.th / 2 + d).lineTo(sx - l.tw / 2, sy + d).close();
      lip.moveTo(sx - l.tw / 2, sy).lineTo(sx, sy + l.th / 2).lineTo(sx, sy + l.th / 2 + lipH).lineTo(sx - l.tw / 2, sy + lipH).close();
    }
    if (!isTileInRadius(t.x + 1, t.y, radius)) {
      right.moveTo(sx, sy + l.th / 2).lineTo(sx + l.tw / 2, sy).lineTo(sx + l.tw / 2, sy + d).lineTo(sx, sy + l.th / 2 + d).close();
      lip.moveTo(sx, sy + l.th / 2).lineTo(sx + l.tw / 2, sy).lineTo(sx + l.tw / 2, sy + lipH).lineTo(sx, sy + l.th / 2 + lipH).close();
    }
  }
  const bottom = l.cy + l.halfH + d + l.tw * (0.5 + radius * 0.34);
  const rock = (shrink: number, dy: number, lift = 0) =>
    Skia.PathBuilder.Make()
      .moveTo(l.cx - l.halfW * shrink, l.cy + dy)
      .quadTo(l.cx - l.halfW * 0.72 * shrink, bottom - lift - (bottom - l.cy) * 0.04, l.cx - l.tw * 0.12, bottom - lift - dy)
      .quadTo(l.cx + l.halfW * 0.62 * shrink, bottom - lift - (bottom - l.cy) * 0.12, l.cx + l.halfW * shrink, l.cy + dy)
      .close()
      .build();

  // Jagged teeth hang from the underside, roots dangle from the earth.
  const rand = mulberry32(radius * 31 + 7);
  const teeth = Skia.PathBuilder.Make();
  const span = bottom - l.cy;
  for (let i = 0; i < 5 + radius; i++) {
    const f = (i + 0.5) / (5 + radius) - 0.5;
    const x = l.cx + f * l.halfW * 1.25 + (rand() - 0.5) * l.tw * 0.3;
    // Follow the belly of the rock: deepest in the middle.
    const y = l.cy + span * (0.42 + 0.5 * (1 - 4 * f * f)) * 0.86;
    const wdt = l.tw * (0.18 + rand() * 0.2);
    const len = l.tw * (0.25 + rand() * 0.45);
    teeth.moveTo(x - wdt, y - len * 0.3).lineTo(x + wdt, y - len * 0.3).lineTo(x + (rand() - 0.5) * wdt, y + len).close();
  }
  const roots = Skia.PathBuilder.Make();
  for (const t of tiles) {
    const frontLeft = !isTileInRadius(t.x, t.y + 1, radius);
    const frontRight = !isTileInRadius(t.x + 1, t.y, radius);
    if ((!frontLeft && !frontRight) || rand() > 0.55) continue;
    const { sx, sy } = tileToScreen(l, t.x, t.y);
    const x = sx + (frontLeft ? -1 : 1) * l.tw * (0.1 + rand() * 0.3);
    const y = sy + l.th * 0.3 + d * 0.95;
    const len = l.tw * (0.25 + rand() * 0.5);
    const bend = (rand() - 0.5) * l.tw * 0.3;
    roots.moveTo(x, y).quadTo(x + bend, y + len * 0.5, x + bend * 0.4, y + len);
    if (rand() > 0.5) roots.moveTo(x + bend * 0.5, y + len * 0.45).lineTo(x + bend * 0.5 + l.tw * 0.1, y + len * 0.75);
  }
  // Small rocks that broke off and float beside the island.
  const drifters = [
    { x: l.cx - l.halfW * 1.02, y: l.cy + span * 0.55, r: l.tw * 0.22 },
    { x: l.cx + l.halfW * 0.98, y: l.cy + span * 0.42, r: l.tw * 0.16 },
    { x: l.cx + l.halfW * 0.62, y: l.cy + span * 0.86, r: l.tw * 0.12 },
  ].map((p) => ({
    ...p,
    path: Skia.PathBuilder.Make()
      .moveTo(-p.r, -p.r * 0.2)
      .lineTo(-p.r * 0.3, -p.r * 0.7)
      .lineTo(p.r * 0.8, -p.r * 0.5)
      .lineTo(p.r, p.r * 0.1)
      .lineTo(p.r * 0.1, p.r * 0.9)
      .lineTo(-p.r * 0.7, p.r * 0.5)
      .close()
      .build(),
    top: Skia.PathBuilder.Make()
      .moveTo(-p.r, -p.r * 0.2)
      .lineTo(-p.r * 0.3, -p.r * 0.7)
      .lineTo(p.r * 0.8, -p.r * 0.5)
      .lineTo(p.r, p.r * 0.1)
      .lineTo(0, -p.r * 0.05)
      .close()
      .build(),
  }));
  return {
    tiles,
    topA: topA.build(),
    topB: topB.build(),
    left: left.build(),
    right: right.build(),
    lip: lip.build(),
    rocks: [rock(0.97, 0), rock(0.86, l.tw * 0.1, span * 0.05), rock(0.64, l.tw * 0.25, span * 0.1), rock(0.38, l.tw * 0.45, span * 0.2)],
    teeth: teeth.build(),
    roots: roots.build(),
    drifters,
    bottom,
  };
}

/** Grass tufts, wildflowers (or fallen leaves) and pebbles on the tiles nothing stands on. */
function buildDecor(l: IslandLayout, tiles: { x: number; y: number; key: string }[], taken: (key: string) => boolean, season: Season) {
  const tufts = Skia.PathBuilder.Make();
  const dotsA = Skia.PathBuilder.Make();
  const dotsB = Skia.PathBuilder.Make();
  const pebbles = Skia.PathBuilder.Make();
  for (const t of tiles) {
    if (taken(t.key)) continue;
    const rand = mulberry32(hashString(`decor${t.key}`));
    const { sx, sy } = tileToScreen(l, t.x, t.y);
    const spot = () => {
      // A point well inside the diamond.
      const u = (rand() - 0.5) * 0.9;
      const v = (rand() - 0.5) * 0.9;
      return { x: sx + ((u - v) * l.tw) / 2 * 0.72, y: sy + ((u + v) * l.th) / 2 * 0.72 };
    };
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const p = spot();
      const hgt = l.tw * (0.07 + rand() * 0.06);
      for (const lean of [-0.6, 0, 0.6]) tufts.moveTo(p.x, p.y).quadTo(p.x + lean * hgt * 0.3, p.y - hgt * 0.6, p.x + lean * hgt * 0.8, p.y - hgt);
    }
    if (rand() < 0.42) {
      const count = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < count; i++) {
        const p = spot();
        const r = l.tw * 0.028;
        const target = rand() < 0.5 ? dotsA : dotsB;
        if (season === 'autumn') target.addOval({ x: p.x - r * 1.6, y: p.y - r * 0.7, width: r * 3.2, height: r * 1.4 });
        else target.addCircle(p.x, p.y - (season === 'winter' ? 0 : l.tw * 0.06), r);
      }
    }
    if (rand() < 0.16) {
      const p = spot();
      pebbles.addOval({ x: p.x - l.tw * 0.045, y: p.y - l.tw * 0.02, width: l.tw * 0.09, height: l.tw * 0.045 });
    }
  }
  return { tufts: tufts.build(), dotsA: dotsA.build(), dotsB: dotsB.build(), pebbles: pebbles.build() };
}

const SEASON_GROUND: Record<Season, { a: string; b: string; lip: string; tuft: string; dots: [string, string]; wiltA: string; wiltB: string }> = {
  spring: { a: '#86DB7C', b: '#78D072', lip: '#52AE5C', tuft: '#4FB55C', dots: ['#FFFFFF', '#FFC9DD'], wiltA: '#C6BB86', wiltB: '#BBAF7B' },
  summer: { a: '#7FD67F', b: '#71CB73', lip: '#4FA95A', tuft: '#48AC58', dots: ['#FFFFFF', '#FFE066'], wiltA: '#C6BB86', wiltB: '#BBAF7B' },
  autumn: { a: '#B5CB6B', b: '#A8C060', lip: '#879C46', tuft: '#8BA548', dots: ['#E8913A', '#D9542B'], wiltA: '#C9B87E', wiltB: '#BEAC73' },
  winter: { a: '#F1F6F8', b: '#E4EDF1', lip: '#C3D3DA', tuft: '#A9BDB6', dots: ['#FFFFFF', '#FFFFFF'], wiltA: '#DAD6C6', wiltB: '#CFCBBB' },
};

/** Geometry of the water on the island: the sunken surface and the falls at the front rim. */
function buildWater(l: IslandLayout, radius: number, terrain: Record<string, TerrainKind>) {
  const surface = Skia.PathBuilder.Make();
  const falls = Skia.PathBuilder.Make();
  const centres: { sx: number; sy: number }[] = [];
  /** Each fall: the two top corners of the stream and how far it drops. */
  const streams: { ax: number; ay: number; bx: number; by: number; drop: number }[] = [];
  const drop = l.depth + l.tw * 0.75;
  for (const key of Object.keys(terrain).sort()) {
    if (terrain[key] !== 'water') continue;
    const { x, y } = parseTile(key);
    if (!isTileInRadius(x, y, radius)) continue;
    const { sx, sy } = tileToScreen(l, x, y);
    diamond(surface, sx, sy, l.tw + 0.8, l.th + 0.4);
    centres.push({ sx, sy });
    const edge = (x0: number, y0: number, x1: number, y1: number) => {
      // The stream uses the middle 60% of the tile edge.
      const ax = x0 + (x1 - x0) * 0.2;
      const ay = y0 + (y1 - y0) * 0.2;
      const bx = x0 + (x1 - x0) * 0.8;
      const by = y0 + (y1 - y0) * 0.8;
      falls.moveTo(ax, ay).lineTo(bx, by).lineTo(bx, by + drop).lineTo(ax, ay + drop).close();
      streams.push({ ax, ay, bx, by, drop });
    };
    if (!isTileInRadius(x, y + 1, radius)) edge(sx - l.tw / 2, sy, sx, sy + l.th / 2);
    if (!isTileInRadius(x + 1, y, radius)) edge(sx, sy + l.th / 2, sx + l.tw / 2, sy);
  }
  const mist = Skia.PathBuilder.Make();
  for (const f of streams) mist.addCircle((f.ax + f.bx) / 2, (f.ay + f.by) / 2 + f.drop, l.tw * 0.2);

  // Lily pads float on some tiles, reeds stand where water meets land at the
  // back, and a lake gets a couple of stepping stones.
  const pads = Skia.PathBuilder.Make();
  const blooms = Skia.PathBuilder.Make();
  const reeds = Skia.PathBuilder.Make();
  const heads = Skia.PathBuilder.Make();
  const stones = Skia.PathBuilder.Make();
  const stoneTops = Skia.PathBuilder.Make();
  const padded = padTiles(terrain);
  const waterKeys = Object.keys(terrain).filter((k) => terrain[k] === 'water').sort();
  for (const key of waterKeys) {
    const { x, y } = parseTile(key);
    if (!isTileInRadius(x, y, radius)) continue;
    const { sx, sy } = tileToScreen(l, x, y);
    const rand = mulberry32(hashString(`w${key}`));
    if (padded.has(key)) {
      for (const pad of padSpots(l, key)) {
        pads.addOval({ x: pad.x - pad.r, y: pad.y - pad.r * 0.5 - l.th * 0.16, width: pad.r * 2, height: pad.r });
        if (pad.bloom) blooms.addCircle(pad.x + pad.r * 0.2, pad.y - pad.r * 0.15 - l.th * 0.16, pad.r * 0.3);
      }
    } else if (rand() < 0.3 && waterKeys.length >= 3) {
      for (const [ox, oy] of [[-0.14, 0.02], [0.12, 0.12]]) {
        const px = sx + ox * l.tw;
        const py = sy + l.th * 0.16 + oy * l.th;
        const r = l.tw * 0.075;
        stones.addOval({ x: px - r, y: py - r * 0.45, width: r * 2, height: r });
        stoneTops.addOval({ x: px - r * 0.8, y: py - r * 0.55, width: r * 1.6, height: r * 0.7 });
      }
    }
    // Reeds on the two far edges, where the bank is.
    const far: [boolean, number, number, number, number][] = [
      [terrain[`${x},${y - 1}`] !== 'water' && isTileInRadius(x, y - 1, radius), sx, sy - l.th / 2, sx + l.tw / 2, sy],
      [terrain[`${x - 1},${y}`] !== 'water' && isTileInRadius(x - 1, y, radius), sx - l.tw / 2, sy, sx, sy - l.th / 2],
    ];
    for (const [bank, x0, y0, x1, y1] of far) {
      if (!bank || rand() > 0.6) continue;
      const count = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < count; i++) {
        const f = 0.2 + rand() * 0.6;
        const bx = x0 + (x1 - x0) * f;
        const by = y0 + (y1 - y0) * f + l.th * 0.14;
        const hgt = l.tw * (0.2 + rand() * 0.16);
        const lean = (rand() - 0.5) * l.tw * 0.08;
        reeds.moveTo(bx, by).quadTo(bx + lean * 0.4, by - hgt * 0.5, bx + lean, by - hgt);
        heads.addRRect({ rect: { x: bx + lean - l.tw * 0.014, y: by - hgt - l.tw * 0.03, width: l.tw * 0.028, height: l.tw * 0.085 }, rx: l.tw * 0.014, ry: l.tw * 0.014 });
      }
    }
  }
  return {
    surface: surface.build(),
    falls: falls.build(),
    mist: mist.build(),
    pads: pads.build(),
    blooms: blooms.build(),
    reeds: reeds.build(),
    heads: heads.build(),
    stones: stones.build(),
    stoneTops: stoneTops.build(),
    centres,
    streams,
    empty: centres.length === 0,
  };
}

function IslandWater({
  layout: l,
  radius,
  terrain,
  vitality,
  clock,
  level,
  frozen,
}: {
  layout: IslandLayout;
  radius: number;
  terrain: Record<string, TerrainKind>;
  vitality: SharedValue<number>;
  clock: SharedValue<number>;
  /** How full the water is: 1 = full, 0 = dried to mud. */
  level: number;
  /** Winter: the surface is ice. */
  frozen: boolean;
}) {
  const water = useMemo(() => buildWater(l, radius, terrain), [l, radius, terrain]);
  // The surface sinks as the water runs low.
  const sink = l.th * (0.16 + 0.2 * (1 - level));
  const wet = Math.min(1, level / 0.3);

  // Clear blue while the island is alive, murky when it is neglected.
  const deep = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], ['#6F7A5E', frozen ? '#9CCBE6' : '#2F8FCF']));
  const top = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], ['#8E9A78', frozen ? '#D3ECF8' : '#56BDEE']));
  const shimmerOpacity = useDerivedValue(() => (0.15 + 0.5 * vitality.value) * wet * (frozen ? 0.45 : 1));
  const padColor = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], ['#8F9A63', '#4DAF5E']));
  const reedColor = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], ['#A39A6A', '#5E9E55']));
  const reedSway = useDerivedValue(() => [{ skewX: Math.sin(clock.value / 1100) * 0.05 }]);
  const surfaceShift = useMemo(() => [{ translateY: sink }], [sink]);

  const shimmer = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    // Ice does not ripple: its glints stay where they are.
    const t = frozen ? 3 : clock.value / 1000;
    const n = Math.min(water.centres.length, 28);
    for (let i = 0; i < n; i++) {
      const c = water.centres[i];
      for (let k = 0; k < 2; k++) {
        const x = c.sx + Math.sin(t * 0.55 + i * 1.9 + k * 2.4) * l.tw * 0.2;
        const y = c.sy + sink + Math.cos(t * 0.4 + i * 1.3 + k * 1.1) * l.th * 0.17;
        const w = l.tw * (0.07 + 0.05 * Math.sin(t * 0.9 + i + k));
        b.addOval({ x: x - w, y: y - 1, width: w * 2, height: 2 });
      }
    }
    return b.build();
  });

  const streaks = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const t = clock.value / 1000;
    for (let i = 0; i < water.streams.length; i++) {
      const f = water.streams[i];
      for (let k = 0; k < 4; k++) {
        const a = 0.12 + 0.25 * k;
        const x = f.ax + (f.bx - f.ax) * a;
        const y0 = f.ay + (f.by - f.ay) * a;
        const k1 = (t * (0.9 + 0.13 * k) + k * 0.37 + i * 0.21) % 1;
        const len = f.drop * 0.22;
        const y = y0 + k1 * (f.drop - len);
        b.addRRect({ rect: { x: x - 1.2, y, width: 2.4, height: len }, rx: 1.2, ry: 1.2 });
      }
    }
    return b.build();
  });

  if (water.empty) return null;
  return (
    <Group>
      {/* The bank shows as a thin strip of earth along the far edges of the water. */}
      <Path path={water.surface} color="#6B4A33" />
      <Group clip={water.surface}>
        <Group transform={surfaceShift}>
          <Path path={water.surface} color={deep} />
        </Group>
        <Group transform={[{ translateY: sink + l.th * 0.07 }]}>
          <Path path={water.surface} color={top} opacity={0.75} />
        </Group>
        {/* Cracked mud shows through as the water dries up. */}
        {level < 1 && <Path path={water.surface} color="#7A6248" opacity={(1 - level) * 0.92} />}
        <Path path={shimmer} color="#FFFFFF" opacity={shimmerOpacity} />
        <Group transform={surfaceShift}>
          <Path path={water.stones} color="#7C858C" />
          <Path path={water.stoneTops} color="#AEB6BC" />
          {!frozen && (
            <>
              <Path path={water.pads} color={padColor} />
              <Path path={water.blooms} color="#FFC2D6" opacity={Math.min(1, level * 1.6)} />
            </>
          )}
        </Group>
      </Group>
      <Group transform={reedSway} origin={{ x: l.cx, y: l.cy }}>
        <Path path={water.reeds} color={reedColor} style="stroke" strokeWidth={Math.max(1.2, l.tw * 0.022)} strokeCap="round" />
        <Path path={water.heads} color="#7A5230" />
      </Group>
      {water.streams.length > 0 && level > 0.45 && !frozen && (
        <Group>
          <Path path={water.falls} color={top} opacity={0.92} />
          <Path path={streaks} color="#FFFFFF" opacity={0.6} />
          <Path path={water.mist} color="#FFFFFF" opacity={0.75}>
            <BlurMask blur={l.tw * 0.11} style="normal" />
          </Path>
        </Group>
      )}
    </Group>
  );
}

/** The shadow something throws on the ground: short at noon, long and to the side when the sun is low. */
function GroundShadow({ sx, sy, half, shade }: { sx: number; sy: number; half: number; shade: Shadow }) {
  const reach = half * (0.9 + (shade.length - 1) * 0.9);
  const cx = sx + shade.dx * reach * 0.75;
  return <Oval x={cx - reach} y={sy - half * 0.24} width={reach * 2} height={half * 0.5} color="#12301F" opacity={0.17 * (0.45 + 0.55 * shade.strength)} />;
}

/** A rock, log, beehive, campfire or landmark standing on a tile. */
function IslandObject({
  kind,
  ruined,
  unit,
  sx,
  sy,
  clock,
  popIn,
  shade,
  glow,
}: {
  kind: TerrainKind;
  ruined: boolean;
  shade: Shadow;
  /** How strongly fire and lamps glow (more at night). */
  glow: number;
  unit: number;
  sx: number;
  sy: number;
  clock: SharedValue<number>;
  popIn: boolean;
}) {
  const sprite = useMemo(() => terrainSprite(kind, unit, ruined), [kind, unit, ruined]);
  const pop = useSharedValue(popIn ? 0 : 1);
  useEffect(() => {
    if (popIn) pop.value = withSpring(1, motion.pop);
  }, [popIn, pop]);
  const transform = useDerivedValue(() => [{ translateX: sx }, { translateY: sy }, { scale: pop.value }]);
  const flicker = useDerivedValue(() => {
    const t = clock.value / 1000;
    return [{ scaleX: 1 + Math.sin(t * 9) * 0.06 }, { scaleY: 1 + Math.sin(t * 13 + 1) * 0.1 + Math.sin(t * 7) * 0.05 }];
  });
  const spin = useDerivedValue(() => [{ rotate: clock.value / 2600 }]);
  // Smoke puffs rise from a burning fire and thin out.
  const smoke = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const t = clock.value / 1000;
    for (let i = 0; i < 5; i++) {
      const f = (t * 0.22 + i / 5) % 1;
      const x = sx + Math.sin(t * 0.7 + i * 2.1) * unit * 0.08 * (0.4 + f) + f * unit * 0.12;
      b.addCircle(x, sy - unit * (0.42 + f * 0.95), unit * (0.045 + f * 0.1) * Math.sin(Math.PI * Math.min(1, f * 1.25)) + 0.01);
    }
    return b.build();
  });
  const smoking = kind === 'campfire';
  return (
    <Group zIndex={sy}>
      <GroundShadow sx={sx} sy={sy} half={sprite.width * 0.45} shade={shade} />
      <Group transform={transform}>
        <PlantBody parts={sprite.parts} />
        {sprite.spin && (
          <Group transform={spin} origin={{ x: sprite.spin.cx, y: sprite.spin.cy }}>
            <PlantBody parts={sprite.spin.parts} />
          </Group>
        )}
        {sprite.alt && (
          <Group transform={flicker} opacity={smoking ? 1 : 0.35 + 0.65 * glow}>
            <PlantGlow parts={sprite.alt} />
            <PlantBody parts={sprite.alt} />
          </Group>
        )}
      </Group>
      {smoking && (
        <Path path={smoke} color="#E9ECEF" opacity={0.42}>
          <BlurMask blur={unit * 0.035} style="normal" />
        </Path>
      )}
    </Group>
  );
}

interface PlantProps {
  season: Season;
  /** Size for its age (sprout .. ancient). */
  grown: number;
  shade: Shadow;
  /** How hard the wind blows (1 = a calm day). */
  wind: number;
  speciesId: string;
  unit: number;
  sx: number;
  sy: number;
  threshold: number;
  phase: number;
  vitality: SharedValue<number>;
  clock: SharedValue<number>;
  popIn: boolean;
}

const BAND = CONFIG.decay.wiltBand;

function IslandPlant({ speciesId, unit, sx, sy, threshold, phase, vitality, clock, popIn, season, grown, shade, wind }: PlantProps) {
  const sprite = useMemo(() => plantSprite(speciesId, unit * grown, season), [speciesId, unit, grown, season]);
  const pop = useSharedValue(popIn ? 0 : 1);
  useEffect(() => {
    if (popIn) pop.value = withSpring(1, motion.pop);
  }, [popIn, pop]);

  const transform = useDerivedValue(() => {
    const decline = (threshold - vitality.value) / BAND;
    const w = Math.min(1, Math.max(0, decline));
    // Past wilted the plant goes bare: it sags further and thins out.
    const bare = vitality.value <= 0.001 ? 1 : Math.min(1, Math.max(0, decline - 1.4));
    // A steady sway, plus gusts that travel across the island from left to right.
    const gust = Math.max(0, Math.sin(clock.value / 2300 - sx / 130)) ** 3;
    const sway = (Math.sin(clock.value / 900 + phase * 6.28) * 0.04 + gust * 0.07 * wind) * (1 - w * 0.8);
    const lean = (phase > 0.5 ? 1 : -1) * (w * 0.28 + bare * 0.12);
    return [
      { translateX: sx },
      { translateY: sy },
      { rotate: sway + lean },
      { scaleX: pop.value * (1 + w * 0.04 - bare * 0.14) },
      { scaleY: pop.value * (1 - w * 0.2 - bare * 0.14) },
    ];
  });
  const bodyOpacity = useDerivedValue(() => {
    const decline = (threshold - vitality.value) / BAND;
    const bare = vitality.value <= 0.001 ? 1 : Math.min(1, Math.max(0, decline - 1.4));
    return 1 - bare * 0.3;
  });
  const wiltOpacity = useDerivedValue(() => Math.min(1, Math.max(0, (threshold - vitality.value) / BAND)));
  const glowOpacity = useDerivedValue(() => 1 - Math.min(1, Math.max(0, (threshold - vitality.value) / BAND)));

  return (
    <Group zIndex={sy}>
      <GroundShadow sx={sx} sy={sy} half={sprite.halfWidth * 0.8} shade={shade} />
      <Group transform={transform} opacity={bodyOpacity}>
        <Group opacity={glowOpacity}>
          <PlantGlow parts={sprite.parts} />
        </Group>
        <PlantBody parts={sprite.parts} />
        <Group opacity={wiltOpacity}>
          <PlantBody parts={sprite.parts} wiltedLook />
        </Group>
      </Group>
    </Group>
  );
}

/** What is left of a dead plant, or the twig of a withered session. */
function IslandRemains({ kind, unit, sx, sy }: { kind: 'stump' | 'stalks' | 'twig'; unit: number; sx: number; sy: number }) {
  const sprite = useMemo(() => remainsSprite(kind, unit), [kind, unit]);
  return (
    <Group zIndex={sy} transform={[{ translateX: sx }, { translateY: sy }]}>
      <Oval x={-sprite.width * 0.5} y={-sprite.width * 0.1} width={sprite.width} height={sprite.width * 0.24} color="#12301F" opacity={0.14} />
      <PlantBody parts={sprite.parts} />
    </Group>
  );
}

interface IslandProps {
  layout: IslandLayout;
  world: Pick<World, 'tiles' | 'radius' | 'terrain'>;
  seeds: Record<string, Seed>;
  /** The animals that are out (see `buildWildlife`). */
  scene?: WildlifeScene;
  /** The latest tap on an animal. */
  poke?: SharedValue<Poke>;
  /** Displayed vitality (animate it to make the island fade or revive). */
  vitality: SharedValue<number>;
  clock: SharedValue<number>;
  /** Highlight every free tile (a seed is ready to be planted). */
  showFreeTiles?: boolean;
  selectedTile?: string | null;
  /** Tile whose plant should pop in. */
  poppedTile?: string | null;
  /** Scale impulse applied to the whole island (1 at rest). */
  scale?: SharedValue<number>;
  /** Disable the idle bobbing (used for the share picture). */
  still?: boolean;
  /** How full ponds and lakes are (1 = full, 0 = mud). */
  waterLevel?: number;
  /** Landmarks that lie in ruins. */
  ruined?: readonly string[];
  /** Tiles marked by a withered session (a dead twig). */
  marks?: readonly string[];
  /** Time of day, season and weather: shadows, seasonal colours, wind. */
  atmo?: Atmosphere;
  /** The moment the picture shows (for how grown the plants are). */
  now?: number;
  /** Zoom (1 = fitted) and pan in pixels. */
  zoom?: SharedValue<number>;
  panX?: SharedValue<number>;
  panY?: SharedValue<number>;
  /** 0..1: a band of light sweeps over the island (level up). */
  sweep?: SharedValue<number>;
  /** 0..1: a ring of fresh green spreads from the centre (the island revives). */
  flood?: SharedValue<number>;
  /** Leave out the mist and the drifting rocks (small pictures). */
  plain?: boolean;
}

const NOON: Shadow = { dx: 0, length: 1, strength: 1 };

const NO_STRINGS: readonly string[] = [];

/** The floating island: rock, earth, water, plants and wildlife. Must be used inside a Canvas. */
export function Island({
  layout: l,
  world,
  seeds,
  scene = EMPTY_SCENE,
  poke,
  vitality,
  clock,
  showFreeTiles = false,
  selectedTile = null,
  poppedTile = null,
  scale,
  still = false,
  waterLevel = 1,
  ruined = NO_STRINGS,
  marks = NO_STRINGS,
  atmo,
  now,
  zoom,
  panX,
  panY,
  sweep,
  flood,
  plain = false,
}: IslandProps) {
  const ground = useMemo(() => buildGround(l, world.radius), [l, world.radius]);
  const ownPoke = useSharedValue<Poke>(NO_POKE);
  const terrain = world.terrain;
  const season: Season = atmo?.season ?? 'summer';
  const shade = atmo?.shadow ?? NOON;
  const wind = atmo?.weather === 'rain' || atmo?.weather === 'snow' ? 1.8 : atmo?.weather === 'fog' ? 0.4 : 1;
  const glow = atmo ? 1 - atmo.daylight : 0.5;
  const tones = SEASON_GROUND[season];

  const grassA = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], [tones.wiltA, tones.a]));
  const grassB = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], [tones.wiltB, tones.b]));
  const lipColor = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], ['#9C9264', tones.lip]));
  const tuftColor = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], ['#A39A6A', tones.tuft]));
  const dotOpacity = useDerivedValue(() => (season === 'autumn' ? 0.9 : Math.min(1, Math.max(0, (vitality.value - 0.35) / 0.3))));

  const float = useDerivedValue(() => {
    const bob = still ? 0 : Math.sin(clock.value / 1700) * 4;
    const s = (scale ? scale.value : 1) * (zoom ? zoom.value : 1);
    return [
      { translateX: panX ? panX.value : 0 },
      { translateY: bob + (panY ? panY.value : 0) },
      { translateX: l.cx },
      { translateY: l.cy },
      { scale: s },
      { translateX: -l.cx },
      { translateY: -l.cy },
    ];
  });

  const decor = useMemo(
    () => buildDecor(l, ground.tiles, (key) => !!world.tiles[key] || !!terrain[key], season),
    [l, ground, world.tiles, terrain, season],
  );

  // The rocks that float beside the island bob out of step with it.
  const drift0 = useDerivedValue(() => [{ translateX: ground.drifters[0].x }, { translateY: ground.drifters[0].y + Math.sin(clock.value / 1300) * 5 }]);
  const drift1 = useDerivedValue(() => [{ translateX: ground.drifters[1].x }, { translateY: ground.drifters[1].y + Math.sin(clock.value / 1500 + 2) * 4 }]);
  const drift2 = useDerivedValue(() => [{ translateX: ground.drifters[2].x }, { translateY: ground.drifters[2].y + Math.sin(clock.value / 1100 + 4) * 3 }]);
  const drifts = [drift0, drift1, drift2];
  const mistShift = useDerivedValue(() => [{ translateX: Math.sin(clock.value / 7000) * l.tw * 0.4 }]);

  const sweepBand = useDerivedValue(() => {
    const k = sweep ? sweep.value : 0;
    return [{ translateX: l.cx + (k * 2 - 1) * l.halfW * 1.7 }, { translateY: l.cy }, { skewX: -0.35 }];
  });
  const sweepOpacity = useDerivedValue(() => {
    const k = sweep ? sweep.value : 0;
    return k <= 0 || k >= 1 ? 0 : Math.sin(Math.PI * k) * 0.55;
  });
  const floodRing = useDerivedValue(() => {
    const k = flood ? flood.value : 0;
    return [{ translateX: l.cx }, { translateY: l.cy }, { scale: 0.05 + k * 1.25 }];
  });
  const floodOpacity = useDerivedValue(() => {
    const k = flood ? flood.value : 0;
    return k <= 0 || k >= 1 ? 0 : (1 - k) * 0.7;
  });
  const stage = now == null ? 2 : -1;

  const free = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    for (const t of ground.tiles) {
      if (world.tiles[t.key] || terrain[t.key]) continue;
      const { sx, sy } = tileToScreen(l, t.x, t.y);
      diamond(b, sx, sy, l.tw, l.th, l.tw * 0.07);
    }
    return b.build();
  }, [ground, world.tiles, terrain, l]);
  const freeOpacity = useDerivedValue(() => 0.3 + 0.25 * Math.sin(clock.value / 320));

  const selected = useMemo(() => {
    if (!selectedTile) return null;
    const { x, y } = parseTile(selectedTile);
    const { sx, sy } = tileToScreen(l, x, y);
    const b = Skia.PathBuilder.Make();
    diamond(b, sx, sy, l.tw, l.th, l.tw * 0.03);
    return b.build();
  }, [selectedTile, l]);

  const plants = useMemo(
    () =>
      ground.tiles
        .filter((t) => world.tiles[t.key] && seeds[world.tiles[t.key]])
        .map((t) => {
          const seed = seeds[world.tiles[t.key]];
          const { sx, sy } = tileToScreen(l, t.x, t.y);
          return {
            key: t.key,
            dead: seed.diedAt != null,
            grown: CONFIG.world.growthScale[stage >= 0 ? stage : growthStage(seed.plantedAt, now!)],
            tall: ['tree', 'pine'].includes(getSpecies(seed.speciesId).kind),
            speciesId: seed.speciesId,
            sx,
            sy: sy + l.th * 0.08,
            threshold: wiltThreshold(t.key, world.radius, seed.rarity),
            phase: hash01(`p${t.key}`),
          };
        }),
    [ground, world.tiles, world.radius, seeds, l, stage, now],
  );

  const objects = useMemo(
    () =>
      ground.tiles
        .filter((t) => terrain[t.key] && terrain[t.key] !== 'water')
        .map((t) => {
          const { sx, sy } = tileToScreen(l, t.x, t.y);
          return { key: t.key, kind: terrain[t.key], sx, sy: sy + l.th * 0.1 };
        }),
    [ground, terrain, l],
  );

  const twigs = useMemo(
    () =>
      marks
        .filter((key) => !world.tiles[key] && !terrain[key])
        .map((key) => {
          const { x, y } = parseTile(key);
          const { sx, sy } = tileToScreen(l, x, y);
          return { key, sx, sy: sy + l.th * 0.08 };
        }),
    [marks, world.tiles, terrain, l],
  );

  // Plants, objects and animals are siblings in this group: Skia sorts them by
  // zIndex (their ground position on screen) every frame, so an animal passes
  // behind the trees in front of it.
  return (
    <Group transform={float}>
      {!plain && (
        <Group transform={mistShift} opacity={atmo?.night ? 0.22 : 0.55}>
          <Oval x={l.cx - l.halfW * 1.25} y={ground.bottom - l.tw * 0.5} width={l.halfW * 1.5} height={l.tw * 1.1} color="#FFFFFF">
            <BlurMask blur={l.tw * 0.32} style="normal" />
          </Oval>
          <Oval x={l.cx - l.halfW * 0.2} y={ground.bottom - l.tw * 0.2} width={l.halfW * 1.5} height={l.tw * 1.0} color="#FFFFFF">
            <BlurMask blur={l.tw * 0.3} style="normal" />
          </Oval>
        </Group>
      )}
      <Path path={ground.teeth} color="#46301F" />
      <Path path={ground.rocks[0]} color="#4E3324" />
      <Path path={ground.rocks[1]} color="#5E3F2B" />
      <Path path={ground.rocks[2]} color="#6E4B33" />
      <Path path={ground.rocks[3]} color="#7C573C" />
      <Path path={ground.roots} color="#9B7450" style="stroke" strokeWidth={Math.max(1.2, l.tw * 0.03)} strokeCap="round" />
      {!plain &&
        ground.drifters.map((d, i) => (
          <Group key={i} transform={drifts[i]}>
            <Path path={d.path} color="#5E3F2B" />
            <Path path={d.top} color={grassB} />
          </Group>
        ))}
      <Path path={ground.left} color="#9A6A45" />
      <Path path={ground.right} color="#7B5236" />
      <Path path={ground.lip} color={lipColor} />
      <Path path={ground.topA} color={grassA} />
      <Path path={ground.topB} color={grassB} />
      <Path path={decor.pebbles} color="#9AA1A8" opacity={0.8} />
      <Path path={decor.tufts} color={tuftColor} style="stroke" strokeWidth={Math.max(1, l.tw * 0.02)} strokeCap="round" />
      <Path path={decor.dotsA} color={tones.dots[0]} opacity={dotOpacity} />
      <Path path={decor.dotsB} color={tones.dots[1]} opacity={dotOpacity} />
      <IslandWater layout={l} radius={world.radius} terrain={terrain} vitality={vitality} clock={clock} level={waterLevel} frozen={season === 'winter'} />
      {flood && (
        <Group transform={floodRing} opacity={floodOpacity}>
          <Oval x={-l.halfW} y={-l.halfH} width={l.halfW * 2} height={l.halfH * 2} color="#C8FFB8" style="stroke" strokeWidth={l.tw * 0.5}>
            <BlurMask blur={l.tw * 0.22} style="normal" />
          </Oval>
        </Group>
      )}
      {showFreeTiles && <Path path={free} color="#FFFFFF" opacity={freeOpacity} />}
      {selected && <Path path={selected} color="#FFFFFF" style="stroke" strokeWidth={3} strokeJoin="round" opacity={0.95} />}
      {twigs.map((t) => (
        <IslandRemains key={`twig:${t.key}`} kind="twig" unit={l.unit} sx={t.sx} sy={t.sy} />
      ))}
      {plants.map((p) =>
        p.dead ? (
          <IslandRemains key={`${p.key}:dead`} kind={p.tall ? 'stump' : 'stalks'} unit={l.unit} sx={p.sx} sy={p.sy} />
        ) : (
        <IslandPlant
          key={`${p.key}:${p.speciesId}`}
          speciesId={p.speciesId}
          unit={l.unit}
          sx={p.sx}
          sy={p.sy}
          threshold={p.threshold}
          season={season}
          grown={p.grown}
          shade={shade}
          wind={wind}
          phase={p.phase}
          vitality={vitality}
          clock={clock}
          popIn={poppedTile === p.key}
        />
        ),
      )}
      {objects.map((o) => (
        <IslandObject key={`${o.key}:${o.kind}`} kind={o.kind} ruined={ruined.includes(o.kind)} shade={shade} glow={glow} unit={l.unit} sx={o.sx} sy={o.sy} clock={clock} popIn={poppedTile === o.key} />
      ))}
      <Wildlife scene={scene} clock={clock} vitality={vitality} poke={poke ?? ownPoke} tileW={l.tw} shade={shade} />
      {sweep && (
        <Group zIndex={2_000_000} transform={sweepBand} opacity={sweepOpacity}>
          <Oval x={-l.tw * 0.9} y={-l.halfH * 2.4} width={l.tw * 1.8} height={l.halfH * 5.4} color="#FFFFFF">
            <BlurMask blur={l.tw * 0.5} style="normal" />
          </Oval>
        </Group>
      )}
    </Group>
  );
}
