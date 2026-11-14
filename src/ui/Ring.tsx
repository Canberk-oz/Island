import { BlurMask, Canvas, Circle, Group, Path, Skia, SweepGradient, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors } from './theme';

interface Props {
  size: number;
  /** 0..1 closes the ring, above 1 starts another lap. */
  progress: number;
  thickness?: number;
  trackColor?: string;
  /** Skip the pulsing head (for tiny rings). */
  quiet?: boolean;
}

/**
 * The daily focus ring. While it is open, its head keeps pulsing softly: an
 * unfinished ring should look like it is waiting for you.
 */
export function Ring({ size, progress, thickness = size * 0.1, trackColor = 'rgba(31, 61, 43, 0.12)', quiet = false }: Props) {
  const r = (size - thickness) / 2 - 2;
  const c = size / 2;
  const shown = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    shown.value = withDelay(120, withTiming(progress, { duration: 1100, easing: Easing.out(Easing.cubic) }));
  }, [progress, shown]);

  useEffect(() => {
    if (quiet) return;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
  }, [pulse, quiet]);

  const arc = useMemo(
    () =>
      Skia.PathBuilder.Make()
        .addArc({ x: c - r, y: c - r, width: r * 2, height: r * 2 }, -90, 359.99)
        .build(),
    [c, r],
  );

  const firstLap = useDerivedValue(() => Math.min(1, Math.max(0.0001, shown.value)));
  const secondLap = useDerivedValue(() => Math.min(1, Math.max(0, shown.value - 1)));
  const secondOpacity = useDerivedValue(() => (shown.value > 1.001 ? 1 : 0));

  const headTransform = useDerivedValue(() => {
    const a = (shown.value % 1) * Math.PI * 2 - Math.PI / 2;
    return [{ translateX: c + Math.cos(a) * r }, { translateY: c + Math.sin(a) * r }];
  });
  const headGlow = useDerivedValue(() => (shown.value >= 1 ? 0 : 0.25 + pulse.value * 0.5));
  const headR = useDerivedValue(() => thickness * (0.5 + pulse.value * 0.35));
  const closedGlow = useDerivedValue(() => (shown.value >= 1 ? 0.35 + pulse.value * 0.25 : 0));

  return (
    <Canvas style={{ width: size, height: size }}>
      <Circle cx={c} cy={c} r={r} color={trackColor} style="stroke" strokeWidth={thickness} />
      <Circle cx={c} cy={c} r={r} color={colors.leafLight} style="stroke" strokeWidth={thickness * 1.5} opacity={closedGlow}>
        <BlurMask blur={thickness * 0.8} style="normal" />
      </Circle>
      <Path path={arc} style="stroke" strokeWidth={thickness} strokeCap="round" start={0} end={firstLap}>
        <SweepGradient
          c={vec(c, c)}
          colors={[colors.leafLight, colors.leaf, colors.leafDark, colors.leafLight]}
          transform={[{ rotate: -Math.PI / 2 }]}
          origin={vec(c, c)}
        />
      </Path>
      <Path
        path={arc}
        style="stroke"
        strokeWidth={thickness}
        strokeCap="round"
        start={0}
        end={secondLap}
        color={colors.coin}
        opacity={secondOpacity}
      />
      {!quiet && (
        <Group transform={headTransform}>
          <Circle cx={0} cy={0} r={headR} color={colors.white} opacity={headGlow}>
            <BlurMask blur={thickness * 0.35} style="normal" />
          </Circle>
        </Group>
      )}
    </Canvas>
  );
}

/**
 * A row of small, still rings in one canvas (the week overview).
 * `centers` are the x positions of the ring centres.
 */
export function RingRow({ width, size, centers, values }: { width: number; size: number; centers: number[]; values: number[] }) {
  const thickness = size * 0.14;
  const r = (size - thickness) / 2 - 1;
  const arcs = useMemo(
    () =>
      centers.map((cx) =>
        Skia.PathBuilder.Make()
          .addArc({ x: cx - r, y: size / 2 - r, width: r * 2, height: r * 2 }, -90, 359.99)
          .build(),
      ),
    [centers, r, size],
  );
  return (
    <Canvas style={{ width, height: size }} pointerEvents="none">
      {centers.map((cx, i) => {
        const v = values[i] ?? 0;
        return (
          <Group key={i}>
            <Circle cx={cx} cy={size / 2} r={r} color="rgba(31, 61, 43, 0.12)" style="stroke" strokeWidth={thickness} />
            {v > 0 && (
              <Path path={arcs[i]} style="stroke" strokeWidth={thickness} strokeCap="round" start={0} end={Math.min(1, v)} color={colors.leaf} />
            )}
            {v > 1 && (
              <Path path={arcs[i]} style="stroke" strokeWidth={thickness} strokeCap="round" start={0} end={Math.min(1, v - 1)} color={colors.coin} />
            )}
          </Group>
        );
      })}
    </Canvas>
  );
}
