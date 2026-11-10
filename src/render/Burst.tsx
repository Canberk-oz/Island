import { Path, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { mulberry32 } from '../game/rng';

interface Props {
  /** 0 = just fired, 1 = finished. Animate it with an ease-out timing. */
  t: SharedValue<number>;
  x: number;
  y: number;
  /** Exactly three colours: particles are split evenly between them. */
  colors: [string, string, string];
  count?: number;
  /** Distance the fastest particle travels, in pixels. */
  reach?: number;
  /** Downward pull, in pixels over the whole burst. */
  gravity?: number;
  size?: number;
  seed?: number;
  /** Only shoot into the upper half (for bursts that start on the ground). */
  upward?: boolean;
}

/**
 * A burst of round particles. All particles of one colour are drawn as a
 * single path that is rebuilt on the UI thread, so even big bursts cost only
 * three draw calls.
 */
export function Burst({ t, x, y, colors, count = 36, reach = 160, gravity = 120, size = 6, seed = 1, upward }: Props) {
  const particles = useMemo(() => {
    const rand = mulberry32(seed * 7919 + count);
    const ax: number[] = [];
    const ay: number[] = [];
    const r: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = upward ? Math.PI * (1 + rand()) : rand() * Math.PI * 2;
      const v = reach * (0.35 + rand() * 0.65);
      ax.push(Math.cos(a) * v);
      ay.push(Math.sin(a) * v);
      r.push(size * (0.45 + rand() * 0.75));
    }
    return { ax, ay, r };
  }, [count, reach, size, seed, upward]);

  const build = (group: number, tv: number) => {
    'worklet';
    const b = Skia.PathBuilder.Make();
    if (tv <= 0 || tv >= 1) return b.build();
    const travel = 1 - (1 - tv) * (1 - tv) * (1 - tv);
    const shrink = 1 - tv * tv;
    for (let i = group; i < particles.ax.length; i += 3) {
      b.addCircle(
        x + particles.ax[i] * travel,
        y + particles.ay[i] * travel + gravity * tv * tv,
        Math.max(0.01, particles.r[i] * shrink),
      );
    }
    return b.build();
  };

  const p0 = useDerivedValue(() => build(0, t.value));
  const p1 = useDerivedValue(() => build(1, t.value));
  const p2 = useDerivedValue(() => build(2, t.value));

  return (
    <>
      <Path path={p0} color={colors[0]} />
      <Path path={p1} color={colors[1]} />
      <Path path={p2} color={colors[2]} />
    </>
  );
}
