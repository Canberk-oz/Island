import { BlurMask, Circle, Group, LinearGradient, Oval, Path, Rect, Skia, vec } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { mulberry32 } from '../game/rng';
import type { SkyPalette } from '../ui/theme';

interface SkyProps {
  w: number;
  h: number;
  palette: SkyPalette;
  /** Milliseconds, ever increasing. */
  clock: SharedValue<number>;
}

function cloudPath(scale: number) {
  const b = Skia.PathBuilder.Make();
  b.addCircle(0, 0, 22 * scale);
  b.addCircle(26 * scale, -10 * scale, 28 * scale);
  b.addCircle(58 * scale, 0, 22 * scale);
  b.addCircle(30 * scale, 8 * scale, 24 * scale);
  b.addRRect({ rect: { x: -16 * scale, y: 0, width: 90 * scale, height: 22 * scale }, rx: 11 * scale, ry: 11 * scale });
  return b.build();
}

/** Sky gradient, a soft sun, drifting clouds and floating motes. Idle life for every screen. */
export function Sky({ w, h, palette, clock }: SkyProps) {
  const clouds = useMemo(() => [cloudPath(1), cloudPath(0.7), cloudPath(1.25)], []);
  const stars = useMemo(() => {
    const rand = mulberry32(12);
    const b = Skia.PathBuilder.Make();
    for (let i = 0; i < 46; i++) b.addCircle(rand() * w, rand() * h * 0.55, 0.6 + rand() * 1.2);
    return b.build();
  }, [w, h]);

  const span = w + 320;
  const c0 = useDerivedValue(() => [{ translateX: ((clock.value * 0.006 + w * 0.2) % span) - 160 }, { translateY: h * 0.13 }]);
  const c1 = useDerivedValue(() => [{ translateX: ((clock.value * 0.0035 + w * 0.75) % span) - 160 }, { translateY: h * 0.24 }]);
  const c2 = useDerivedValue(() => [{ translateX: ((clock.value * 0.0048 + w * 1.2) % span) - 160 }, { translateY: h * 0.06 }]);

  const motes = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const t = clock.value / 1000;
    for (let i = 0; i < 14; i++) {
      const seed = i * 97.13;
      const period = 9 + (i % 5) * 2.3;
      const f = ((t + seed) % period) / period;
      const x = (Math.sin(seed) * 0.5 + 0.5) * w + Math.sin(t * 0.6 + i) * 14;
      const y = h * (0.95 - f * 0.7);
      const r = (1.2 + (i % 3)) * Math.sin(f * Math.PI);
      b.addCircle(x, y, Math.max(0.01, r));
    }
    return b.build();
  });

  const twinkle = useDerivedValue(() => 0.55 + 0.25 * Math.sin(clock.value / 900));

  return (
    <Group>
      <Rect x={0} y={0} width={w} height={h}>
        <LinearGradient start={vec(0, 0)} end={vec(0, h)} colors={[palette.top, palette.mid, palette.bottom]} positions={[0, 0.55, 1]} />
      </Rect>
      {palette.dark && <Path path={stars} color="#FFFFFF" opacity={twinkle} />}
      <Circle cx={w * 0.78} cy={h * 0.16} r={w * 0.2} color={palette.sun} opacity={0.5}>
        <BlurMask blur={w * 0.12} style="normal" />
      </Circle>
      <Circle cx={w * 0.78} cy={h * 0.16} r={w * 0.075} color={palette.sun} />
      <Group transform={c0} opacity={palette.dark ? 0.35 : 0.85}>
        <Path path={clouds[0]} color={palette.cloud} />
      </Group>
      <Group transform={c1} opacity={palette.dark ? 0.25 : 0.65}>
        <Path path={clouds[1]} color={palette.cloud} />
      </Group>
      <Group transform={c2} opacity={palette.dark ? 0.3 : 0.75}>
        <Path path={clouds[2]} color={palette.cloud} />
      </Group>
      <Path path={motes} color="#FFFFFF" opacity={palette.dark ? 0.35 : 0.7} />
    </Group>
  );
}

interface HillProps {
  w: number;
  h: number;
  /** y of the hill's crest at the centre. */
  crestY: number;
  dark?: boolean;
}

/** The rounded hill the sapling grows on. */
export function Hill({ w, h, crestY, dark }: HillProps) {
  const back = dark ? '#2F6B4A' : '#8FD694';
  const front = dark ? '#3B8259' : '#6CC47A';
  return (
    <Group>
      <Oval x={-w * 0.55} y={crestY + 26} width={w * 1.5} height={h} color={back} />
      <Oval x={-w * 0.3} y={crestY} width={w * 1.6} height={h * 1.2} color={front} />
    </Group>
  );
}
