import { Group, Oval, Path, Skia, interpolateColors } from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import { useDerivedValue, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { CONFIG } from '../game/config';
import { wiltThreshold } from '../game/decay';
import { hash01 } from '../game/rng';
import type { Seed, World } from '../game/types';
import { isTileInRadius, parseTile, tilesInRadius } from '../game/world';
import { motion } from '../ui/theme';
import { PlantBody, PlantGlow } from './PlantSprite';
import { plantSprite } from './plants';

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
    const w = Math.min(1, Math.max(0, (threshold - vitality.value) / BAND));
    const sway = Math.sin(clock.value / 900 + phase * 6.28) * 0.04 * (1 - w * 0.8);
    const lean = (phase > 0.5 ? 1 : -1) * w * 0.28;
    return [
      { translateX: sx },
      { translateY: sy },
      { rotate: sway + lean },
      { scaleX: pop.value * (1 + w * 0.04) },
      { scaleY: pop.value * (1 - w * 0.2) },
    ];
  });
  const wiltOpacity = useDerivedValue(() => Math.min(1, Math.max(0, (threshold - vitality.value) / BAND)));
  const glowOpacity = useDerivedValue(() => 1 - Math.min(1, Math.max(0, (threshold - vitality.value) / BAND)));

  return (
    <Group>
      <Oval
        x={sx - sprite.halfWidth * 0.8}
        y={sy - sprite.halfWidth * 0.22}
        width={sprite.halfWidth * 1.6}
        height={sprite.halfWidth * 0.44}
        color="#12301F"
        opacity={0.16}
      />
      <Group transform={transform}>
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

interface IslandProps {
  layout: IslandLayout;
  world: Pick<World, 'tiles' | 'radius'>;
  seeds: Record<string, Seed>;
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
}

/** The floating island: rock, earth, grass tiles and every plant. Must be used inside a Canvas. */
export function Island({
  layout: l,
  world,
  seeds,
  vitality,
  clock,
  showFreeTiles = false,
  selectedTile = null,
  poppedTile = null,
  scale,
  still = false,
}: IslandProps) {
  const ground = useMemo(() => buildGround(l, world.radius), [l, world.radius]);

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
      if (world.tiles[t.key]) continue;
      const { sx, sy } = tileToScreen(l, t.x, t.y);
      diamond(b, sx, sy, l.tw, l.th, l.tw * 0.07);
    }
    return b.build();
  }, [ground, world.tiles, l]);
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
            speciesId: seed.speciesId,
            sx,
            sy: sy + l.th * 0.08,
            threshold: wiltThreshold(t.key, world.radius, seed.rarity),
            phase: hash01(`p${t.key}`),
          };
        }),
    [ground, world.tiles, world.radius, seeds, l],
  );

  return (
    <Group transform={float}>
      <Path path={ground.rockBack} color="#5A3A28" />
      <Path path={ground.rockFront} color="#6E4831" />
      <Path path={ground.left} color="#9A6A45" />
      <Path path={ground.right} color="#7B5236" />
      <Path path={ground.lip} color={lipColor} />
      <Path path={ground.topA} color={grassA} />
      <Path path={ground.topB} color={grassB} />
      {showFreeTiles && <Path path={free} color="#FFFFFF" opacity={freeOpacity} />}
      {selected && <Path path={selected} color="#FFFFFF" style="stroke" strokeWidth={3} strokeJoin="round" opacity={0.95} />}
      {plants.map((p) => (
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
      ))}
    </Group>
  );
}
