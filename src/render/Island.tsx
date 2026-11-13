import { BlurMask, Group, Oval, Path, Skia, interpolateColors } from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import { useDerivedValue, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { CONFIG } from '../game/config';
import { wiltThreshold } from '../game/decay';
import { hash01 } from '../game/rng';
import { getSpecies } from '../game/species';
import type { Seed, TerrainKind, World } from '../game/types';
import { isTileInRadius, parseTile, tilesInRadius } from '../game/world';
import { motion } from '../ui/theme';
import { PlantBody, PlantGlow } from './PlantSprite';
import { NO_POKE, Wildlife, type Poke } from './Wildlife';
import { remainsSprite, terrainSprite } from './creatures';
import { plantSprite } from './plants';
import { EMPTY_SCENE, type WildlifeScene } from './wildlife';

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
  const bottom = l.cy + l.halfH + d + l.tw * (0.35 + radius * 0.3);
  const rock = (shrink: number, dy: number) =>
    Skia.PathBuilder.Make()
      .moveTo(l.cx - l.halfW * shrink, l.cy + dy)
      .quadTo(l.cx - l.halfW * 0.72 * shrink, bottom - (bottom - l.cy) * 0.04, l.cx - l.tw * 0.12, bottom - dy)
      .quadTo(l.cx + l.halfW * 0.62 * shrink, bottom - (bottom - l.cy) * 0.12, l.cx + l.halfW * shrink, l.cy + dy)
      .close()
      .build();
  return {
    tiles,
    topA: topA.build(),
    topB: topB.build(),
    left: left.build(),
    right: right.build(),
    lip: lip.build(),
    rockBack: rock(0.9, 0),
    rockFront: rock(0.62, l.tw * 0.25),
  };
}

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
  return { surface: surface.build(), falls: falls.build(), mist: mist.build(), centres, streams, empty: centres.length === 0 };
}

function IslandWater({
  layout: l,
  radius,
  terrain,
  vitality,
  clock,
  level,
}: {
  layout: IslandLayout;
  radius: number;
  terrain: Record<string, TerrainKind>;
  vitality: SharedValue<number>;
  clock: SharedValue<number>;
  /** How full the water is: 1 = full, 0 = dried to mud. */
  level: number;
}) {
  const water = useMemo(() => buildWater(l, radius, terrain), [l, radius, terrain]);
  // The surface sinks as the water runs low.
  const sink = l.th * (0.16 + 0.2 * (1 - level));
  const wet = Math.min(1, level / 0.3);

  // Clear blue while the island is alive, murky when it is neglected.
  const deep = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], ['#6F7A5E', '#2F8FCF']));
  const top = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], ['#8E9A78', '#56BDEE']));
  const shimmerOpacity = useDerivedValue(() => (0.15 + 0.5 * vitality.value) * wet);
  const surfaceShift = useMemo(() => [{ translateY: sink }], [sink]);

  const shimmer = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const t = clock.value / 1000;
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
      </Group>
      {water.streams.length > 0 && level > 0.45 && (
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

/** A rock, log, beehive or campfire standing on a tile. */
function IslandObject({
  kind,
  ruined,
  unit,
  sx,
  sy,
  clock,
  popIn,
}: {
  kind: TerrainKind;
  ruined: boolean;
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
  return (
    <Group zIndex={sy}>
      <Oval x={sx - sprite.width * 0.45} y={sy - sprite.width * 0.1} width={sprite.width * 0.9} height={sprite.width * 0.24} color="#12301F" opacity={0.16} />
      <Group transform={transform}>
        <PlantBody parts={sprite.parts} />
        {sprite.alt && (
          <Group transform={flicker}>
            <PlantGlow parts={sprite.alt} />
            <PlantBody parts={sprite.alt} />
          </Group>
        )}
      </Group>
    </Group>
  );
}

interface PlantProps {
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

function IslandPlant({ speciesId, unit, sx, sy, threshold, phase, vitality, clock, popIn }: PlantProps) {
  const sprite = useMemo(() => plantSprite(speciesId, unit), [speciesId, unit]);
  const pop = useSharedValue(popIn ? 0 : 1);
  useEffect(() => {
    if (popIn) pop.value = withSpring(1, motion.pop);
  }, [popIn, pop]);

  const transform = useDerivedValue(() => {
    const decline = (threshold - vitality.value) / BAND;
    const w = Math.min(1, Math.max(0, decline));
    // Past wilted the plant goes bare: it sags further and thins out.
    const bare = vitality.value <= 0.001 ? 1 : Math.min(1, Math.max(0, decline - 1.4));
    const sway = Math.sin(clock.value / 900 + phase * 6.28) * 0.04 * (1 - w * 0.8);
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
      <Oval
        x={sx - sprite.halfWidth * 0.8}
        y={sy - sprite.halfWidth * 0.22}
        width={sprite.halfWidth * 1.6}
        height={sprite.halfWidth * 0.44}
        color="#12301F"
        opacity={0.16}
      />
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
}

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
}: IslandProps) {
  const ground = useMemo(() => buildGround(l, world.radius), [l, world.radius]);
  const ownPoke = useSharedValue<Poke>(NO_POKE);
  const terrain = world.terrain;

  const grassA = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], ['#C6BB86', '#7FD67F']));
  const grassB = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], ['#BBAF7B', '#71CB73']));
  const lipColor = useDerivedValue(() => interpolateColors(vitality.value, [0, 1], ['#9C9264', '#4FA95A']));

  const float = useDerivedValue(() => {
    const bob = still ? 0 : Math.sin(clock.value / 1700) * 4;
    const s = scale ? scale.value : 1;
    return [{ translateY: bob }, { translateX: l.cx }, { translateY: l.cy }, { scale: s }, { translateX: -l.cx }, { translateY: -l.cy }];
  });

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
            tall: ['tree', 'pine'].includes(getSpecies(seed.speciesId).kind),
            speciesId: seed.speciesId,
            sx,
            sy: sy + l.th * 0.08,
            threshold: wiltThreshold(t.key, world.radius, seed.rarity),
            phase: hash01(`p${t.key}`),
          };
        }),
    [ground, world.tiles, world.radius, seeds, l],
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
      <Path path={ground.rockBack} color="#5A3A28" />
      <Path path={ground.rockFront} color="#6E4831" />
      <Path path={ground.left} color="#9A6A45" />
      <Path path={ground.right} color="#7B5236" />
      <Path path={ground.lip} color={lipColor} />
      <Path path={ground.topA} color={grassA} />
      <Path path={ground.topB} color={grassB} />
      <IslandWater layout={l} radius={world.radius} terrain={terrain} vitality={vitality} clock={clock} level={waterLevel} />
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
          phase={p.phase}
          vitality={vitality}
          clock={clock}
          popIn={poppedTile === p.key}
        />
        ),
      )}
      {objects.map((o) => (
        <IslandObject key={`${o.key}:${o.kind}`} kind={o.kind} ruined={ruined.includes(o.kind)} unit={l.unit} sx={o.sx} sy={o.sy} clock={clock} popIn={poppedTile === o.key} />
      ))}
      <Wildlife scene={scene} clock={clock} vitality={vitality} poke={poke ?? ownPoke} tileW={l.tw} />
    </Group>
  );
}
