import { Circle, Group, Oval, Path, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { CONFIG } from '../game/config';

const SEGMENTS = 40;
const MILESTONES = CONFIG.session.milestones;

/** Point on the stem at fraction t (0 = ground, 1 = full height) for a given bend. */
function stemPoint(t: number, bend: number, height: number) {
  'worklet';
  return {
    x: Math.sin(t * Math.PI * 1.15) * height * 0.06 + bend * height * 0.5 * t * t,
    y: -height * t * (1 - 0.28 * Math.min(1, Math.abs(bend)) * t),
  };
}

/** How much of the full stem is grown at session progress p. */
export function growthAt(p: number) {
  'worklet';
  return 0.1 + 0.9 * p;
}

/** Position of the stem tip relative to the base at full growth and no bend. */
export function saplingTip(height: number) {
  return stemPoint(1, 0, height);
}

export interface SaplingValues {
  /** Session progress 0..1. */
  progress: SharedValue<number>;
  /** 0 = fresh, 1 = withered. */
  wilt: SharedValue<number>;
  /** Squash-and-stretch impulse, rests at 0. */
  pulse: SharedValue<number>;
  /** Pop-in scale of the whole plant. */
  appear: SharedValue<number>;
  /** One pop value (0..1 with overshoot) per leaf pair. */
  leaves: SharedValue<number>[];
  /** Scale of the bud at the tip. */
  bud: SharedValue<number>;
  clock: SharedValue<number>;
}

interface Props extends SaplingValues {
  x: number;
  y: number;
  height: number;
}

function leafPath(len: number) {
  return Skia.PathBuilder.Make()
    .moveTo(0, 0)
    .quadTo(len * 0.45, -len * 0.5, len, 0)
    .quadTo(len * 0.45, len * 0.34, 0, 0)
    .close()
    .build();
}

function LeafPair({
  index,
  height,
  v,
}: {
  index: number;
  height: number;
  v: SaplingValues;
}) {
  const at = MILESTONES[index];
  const attach = growthAt(at) * 0.86;
  const len = height * 0.24 * (1 - index * 0.13);
  const path = useMemo(() => leafPath(len), [len]);
  const vein = useMemo(() => Skia.PathBuilder.Make().moveTo(len * 0.1, 0).lineTo(len * 0.8, 0).build(), [len]);
  const pop = v.leaves[index];

  const place = useDerivedValue(() => {
    const bend = v.wilt.value * 0.9 + Math.sin(v.clock.value / 1100) * 0.025;
    const p = stemPoint(attach, bend, height);
    const grown = 0.6 + 0.4 * Math.min(1, Math.max(0, (v.progress.value - at) / 0.25));
    const s = pop.value * grown;
    return [{ translateX: p.x }, { translateY: p.y }, { scale: s }];
  });
  const right = useDerivedValue(() => {
    const sway = Math.sin(v.clock.value / 850 + index * 1.7) * 0.07 * (1 - v.wilt.value);
    return [{ rotate: -0.5 + sway + v.wilt.value * 1.35 }];
  });
  const left = useDerivedValue(() => {
    const sway = Math.sin(v.clock.value / 900 + index * 2.3) * 0.07 * (1 - v.wilt.value);
    return [{ scaleX: -1 }, { rotate: -0.5 + sway + v.wilt.value * 1.35 }];
  });

  return (
    <Group transform={place}>
      <Group transform={right}>
        <Path path={path} color={index % 2 ? '#63C77F' : '#55BB72'} />
        <Path path={vein} color="#3F9A5E" style="stroke" strokeWidth={1.5} strokeCap="round" opacity={0.6} />
      </Group>
      <Group transform={left}>
        <Path path={path} color={index % 2 ? '#55BB72' : '#63C77F'} />
        <Path path={vein} color="#3F9A5E" style="stroke" strokeWidth={1.5} strokeCap="round" opacity={0.6} />
      </Group>
    </Group>
  );
}

/**
 * The sapling that grows during a session. It is drawn from a stem that is
 * rebuilt every frame (so it can grow and bend), leaf pairs that pop at the
 * milestones, and a bud at the tip that becomes the seed.
 */
export function Sapling({ x, y, height, ...v }: Props) {
  const stem = useDerivedValue(() => {
    const g = growthAt(v.progress.value);
    const bend = v.wilt.value * 0.9 + Math.sin(v.clock.value / 1100) * 0.025;
    const b = Skia.PathBuilder.Make();
    b.moveTo(0, 0);
    for (let i = 1; i <= SEGMENTS; i++) {
      const p = stemPoint((g * i) / SEGMENTS, bend, height);
      b.lineTo(p.x, p.y);
    }
    return b.build();
  });
  const stemWidth = useDerivedValue(() => height * (0.02 + 0.028 * growthAt(v.progress.value)));

  const body = useDerivedValue(() => {
    const breathe = Math.sin(v.clock.value / 1400) * 0.012;
    const sy = v.appear.value * (1 + v.pulse.value * 0.16 + breathe);
    const sx = v.appear.value * (1 - v.pulse.value * 0.12 - breathe * 0.6);
    return [{ translateX: x }, { translateY: y }, { scaleX: sx }, { scaleY: sy }];
  });

  // The soil mound arrives together with the sapling.
  const mound = useDerivedValue(() => [{ translateX: x }, { translateY: y }, { scale: Math.min(1.08, v.appear.value) }]);

  const budPlace = useDerivedValue(() => {
    const g = growthAt(v.progress.value);
    const bend = v.wilt.value * 0.9 + Math.sin(v.clock.value / 1100) * 0.025;
    const p = stemPoint(g, bend, height);
    const s = v.bud.value * (0.55 + 0.45 * v.progress.value);
    return [{ translateX: p.x }, { translateY: p.y }, { rotate: bend * 1.2 }, { scale: s }];
  });

  const budR = height * 0.075;
  const budPath = useMemo(
    () =>
      Skia.PathBuilder.Make()
        .moveTo(0, -budR * 1.9)
        .cubicTo(budR * 1.3, -budR * 0.9, budR * 1.1, budR * 0.5, 0, budR * 0.5)
        .cubicTo(-budR * 1.1, budR * 0.5, -budR * 1.3, -budR * 0.9, 0, -budR * 1.9)
        .close()
        .build(),
    [budR],
  );

  return (
    <Group>
      <Group transform={mound}>
        <Oval x={-height * 0.3} y={-height * 0.05} width={height * 0.6} height={height * 0.16} color="#6B442C" />
        <Oval x={-height * 0.24} y={-height * 0.06} width={height * 0.48} height={height * 0.11} color="#8A5A3C" />
      </Group>
      <Group transform={body}>
        <Path path={stem} color="#3F9A5E" style="stroke" strokeWidth={stemWidth} strokeCap="round" strokeJoin="round" />
        {MILESTONES.map((_, i) => (
          <LeafPair key={i} index={i} height={height} v={v} />
        ))}
        <Group transform={budPlace}>
          <Path path={budPath} color="#C98A4B" />
          <Circle cx={-budR * 0.3} cy={-budR * 0.7} r={budR * 0.28} color="#F1C27D" opacity={0.8} />
        </Group>
      </Group>
    </Group>
  );
}

/** Colour matrix that drains saturation (and a little light) as `wilt` goes 0..1. */
export function wiltMatrix(wilt: number) {
  'worklet';
  const s = 1 - wilt * 0.88;
  const k = 1 - wilt * 0.1;
  const lr = 0.213;
  const lg = 0.715;
  const lb = 0.072;
  return [
    (lr + (1 - lr) * s) * k, lg * (1 - s) * k, lb * (1 - s) * k, 0, 0,
    lr * (1 - s) * k, (lg + (1 - lg) * s) * k, lb * (1 - s) * k, 0, 0,
    lr * (1 - s) * k, lg * (1 - s) * k, (lb + (1 - lb) * s) * k, 0, 0,
    0, 0, 0, 1, 0,
  ];
}
