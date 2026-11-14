import { BlurMask, Circle, ColorMatrix, Group, LinearGradient, Oval, Paint, Path, Rect, Skia, vec } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { Atmosphere } from '../game/atmosphere';
import { mulberry32 } from '../game/rng';
import { mixHex, type SkyPalette } from '../ui/theme';

interface SkyProps {
  w: number;
  h: number;
  palette: SkyPalette;
  /** Milliseconds, ever increasing. */
  clock: SharedValue<number>;
  /** Time of day, season and weather. Without it the sky is a plain fair-weather one. */
  atmo?: Atmosphere;
  /** Leave out the drifting bits (for small or still pictures). */
  calm?: boolean;
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

const RAINBOW = ['#FF6B6B', '#FFA94D', '#FFE066', '#69DB7C', '#4DABF7', '#9775FA'];

/** What drifts through the air in each season. */
const DRIFT = {
  spring: { color: '#FFD3E2', fall: true, n: 14, size: 2.6 },
  summer: { color: '#FFFFFF', fall: false, n: 14, size: 2 },
  autumn: { color: '#E8913A', fall: true, n: 16, size: 3.2 },
  winter: { color: '#FFFFFF', fall: true, n: 0, size: 2 },
} as const;

/**
 * The sky: a gradient for the hour, the sun or moon on its arc, stars,
 * clouds that thicken with the weather, a rainbow after rain, and whatever
 * the season sends drifting through the air.
 */
export function Sky({ w, h, palette, clock, atmo, calm = false }: SkyProps) {
  const clouds = useMemo(() => [cloudPath(1), cloudPath(0.7), cloudPath(1.25), cloudPath(1.7), cloudPath(1.45)], []);
  const stars = useMemo(() => {
    const rand = mulberry32(12);
    const b = Skia.PathBuilder.Make();
    for (let i = 0; i < 46; i++) b.addCircle(rand() * w, rand() * h * 0.55, 0.6 + rand() * 1.2);
    return b.build();
  }, [w, h]);

  const weather = atmo?.weather ?? 'clear';
  const season = atmo?.season ?? 'summer';
  const overcast = weather === 'rain' || weather === 'snow' || weather === 'fog' ? 1 : weather === 'haze' ? 0.6 : 0;
  const daylight = atmo?.daylight ?? (palette.dark ? 0 : 1);

  // The sun or the moon on its arc across the sky.
  const body = atmo?.celestial ?? { sun: !palette.dark, x: 0.78, height: 0.8 };
  const bx = w * (0.1 + 0.8 * body.x);
  const by = h * (0.36 - 0.25 * body.height);
  const bodyR = w * (body.sun ? 0.075 : 0.06);
  const bodyOpacity = 1 - overcast * 0.75;

  const span = w + 420;
  const c0 = useDerivedValue(() => [{ translateX: ((clock.value * 0.006 + w * 0.2) % span) - 210 }, { translateY: h * 0.13 }]);
  const c1 = useDerivedValue(() => [{ translateX: ((clock.value * 0.0035 + w * 0.75) % span) - 210 }, { translateY: h * 0.24 }]);
  const c2 = useDerivedValue(() => [{ translateX: ((clock.value * 0.0048 + w * 1.2) % span) - 210 }, { translateY: h * 0.06 }]);
  const c3 = useDerivedValue(() => [{ translateX: ((clock.value * 0.004 + w * 0.5) % span) - 210 }, { translateY: h * 0.1 }]);
  const c4 = useDerivedValue(() => [{ translateX: ((clock.value * 0.0052 + w * 1.5) % span) - 210 }, { translateY: h * 0.2 }]);

  const drift = DRIFT[season];
  const motes = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    if (calm) return b.build();
    const t = clock.value / 1000;
    for (let i = 0; i < drift.n; i++) {
      const seed = i * 97.13;
      const period = 9 + (i % 5) * 2.3;
      const f = ((t + seed) % period) / period;
      const sway = Math.sin(t * 0.6 + i) * (drift.fall ? 26 : 14);
      const x = (Math.sin(seed) * 0.5 + 0.5) * w + sway + (drift.fall ? f * 40 : 0);
      const y = drift.fall ? h * (0.05 + f * 0.85) : h * (0.95 - f * 0.7);
      const r = (drift.size * 0.6 + (i % 3) * 0.5) * Math.sin(f * Math.PI);
      if (drift.fall) {
        // Petals and leaves tumble: their width breathes as they turn.
        const turn = 0.35 + 0.65 * Math.abs(Math.sin(t * 2.2 + i * 1.7));
        b.addOval({ x: x - r * 1.5 * turn, y: y - r, width: Math.max(0.02, r * 3 * turn), height: Math.max(0.02, r * 2) });
      } else {
        b.addCircle(x, y, Math.max(0.01, r));
      }
    }
    return b.build();
  });

  const twinkle = useDerivedValue(() => (0.55 + 0.25 * Math.sin(clock.value / 900)) * (1 - daylight) * (1 - overcast * 0.8));

  const rainbow = useMemo(() => {
    const cx = w * 0.5;
    const cy = h * 0.62;
    return RAINBOW.map((color, i) => {
      const r = w * (0.62 - i * 0.022);
      const b = Skia.PathBuilder.Make();
      b.addArc({ x: cx - r, y: cy - r, width: r * 2, height: r * 2 }, 180, 180);
      return { color, path: b.build() };
    });
  }, [w, h]);

  const cloudColor = palette.cloud;
  const cloudAlpha = palette.dark ? 0.4 : 1;
  return (
    <Group>
      <Rect x={0} y={0} width={w} height={h}>
        <LinearGradient start={vec(0, 0)} end={vec(0, h)} colors={[palette.top, palette.mid, palette.bottom]} positions={[0, 0.55, 1]} />
      </Rect>
      {daylight < 1 && <Path path={stars} color="#FFFFFF" opacity={twinkle} />}
      <Group opacity={bodyOpacity}>
        <Circle cx={bx} cy={by} r={bodyR * (body.sun ? 2.7 : 2.2)} color={palette.sun} opacity={body.sun ? 0.5 : 0.28}>
          <BlurMask blur={w * 0.12} style="normal" />
        </Circle>
        <Circle cx={bx} cy={by} r={bodyR} color={body.sun ? palette.sun : '#F4F1DE'} />
        {!body.sun && <Circle cx={bx + bodyR * 0.42} cy={by - bodyR * 0.22} r={bodyR * 0.86} color={mixHex(palette.top, palette.mid, 0.25)} />}
      </Group>
      {weather === 'rainbow' && (
        <Group opacity={0.42}>
          {rainbow.map((band) => (
            <Path key={band.color} path={band.path} color={band.color} style="stroke" strokeWidth={w * 0.024} />
          ))}
        </Group>
      )}
      <Group transform={c0} opacity={0.85 * cloudAlpha}>
        <Path path={clouds[0]} color={cloudColor} />
      </Group>
      <Group transform={c1} opacity={0.65 * cloudAlpha}>
        <Path path={clouds[1]} color={cloudColor} />
      </Group>
      <Group transform={c2} opacity={0.75 * cloudAlpha}>
        <Path path={clouds[2]} color={cloudColor} />
      </Group>
      {overcast > 0 && (
        <>
          <Group transform={c3} opacity={0.8 * overcast * (palette.dark ? 0.5 : 1)}>
            <Path path={clouds[3]} color={cloudColor} />
          </Group>
          <Group transform={c4} opacity={0.7 * overcast * (palette.dark ? 0.5 : 1)}>
            <Path path={clouds[4]} color={cloudColor} />
          </Group>
        </>
      )}
      {drift.n > 0 && weather !== 'rain' && weather !== 'snow' && (
        <Path path={motes} color={drift.color} opacity={palette.dark ? 0.35 : season === 'summer' ? 0.7 : 0.85} />
      )}
    </Group>
  );
}

/**
 * Weather that falls or drifts in front of the scene: rain, snow, fog and
 * haze. Draw it after everything else on the canvas.
 */
export function WeatherFront({ w, h, atmo, clock }: { w: number; h: number; atmo: Atmosphere; clock: SharedValue<number> }) {
  const weather = atmo.weather;
  const fall = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const t = clock.value / 1000;
    if (weather === 'rain') {
      for (let i = 0; i < 48; i++) {
        const seed = i * 53.7;
        const speed = 1.5 + (i % 5) * 0.16;
        const f = (t * speed + seed) % 1;
        const x = ((Math.sin(seed) * 0.5 + 0.5) * (w + 80) - 40) - f * 46;
        const y = f * (h + 40) - 20;
        b.moveTo(x, y).lineTo(x - 5, y + 15);
      }
    } else if (weather === 'snow') {
      for (let i = 0; i < 60; i++) {
        const seed = i * 71.3;
        const period = 7 + (i % 6) * 1.4;
        const f = ((t + seed) % period) / period;
        const x = (Math.sin(seed) * 0.5 + 0.5) * w + Math.sin(t * 0.8 + i) * 18;
        b.addCircle(x, f * (h + 20) - 10, 1.2 + (i % 4) * 0.6);
      }
    }
    return b.build();
  });
  const band0 = useDerivedValue(() => [{ translateX: Math.sin(clock.value / 9000) * w * 0.12 }]);
  const band1 = useDerivedValue(() => [{ translateX: Math.cos(clock.value / 12000) * w * 0.16 }]);

  if (weather === 'rain') return <Path path={fall} color="#DCEBFA" style="stroke" strokeWidth={1.4} strokeCap="round" opacity={atmo.night ? 0.26 : 0.4} />;
  if (weather === 'snow') return <Path path={fall} color="#FFFFFF" opacity={0.9} />;
  if (weather === 'fog' || weather === 'haze') {
    const thick = weather === 'fog' ? 1 : 0.5;
    const tone = atmo.night ? '#7C8794' : weather === 'fog' ? '#EEF0EC' : '#EFE6C8';
    return (
      <Group>
        <Rect x={0} y={0} width={w} height={h} color={tone} opacity={0.16 * thick} />
        <Group transform={band0} opacity={0.5 * thick}>
          <Oval x={-w * 0.3} y={h * 0.38} width={w * 1.3} height={h * 0.16} color={tone}>
            <BlurMask blur={h * 0.045} style="normal" />
          </Oval>
        </Group>
        <Group transform={band1} opacity={0.42 * thick}>
          <Oval x={w * 0.05} y={h * 0.52} width={w * 1.4} height={h * 0.14} color={tone}>
            <BlurMask blur={h * 0.04} style="normal" />
          </Oval>
        </Group>
      </Group>
    );
  }
  return null;
}

/** Colour matrix for the light of the hour: blue at night, warm at sunrise and in the golden hour. Null by day. */
export function lightMatrix(atmo: Atmosphere): number[] | null {
  const dark = (1 - atmo.daylight) * 0.6;
  const clear = atmo.weather === 'clear' || atmo.weather === 'rainbow' ? 1 : 0.4;
  const warm = (atmo.phase === 'golden' ? 1 : atmo.phase === 'dusk' || atmo.phase === 'dawn' ? 0.7 : 0) * clear;
  if (dark <= 0.01 && warm <= 0) return null;
  const r = (1 - dark * 0.66) * (1 + 0.07 * warm);
  const g = (1 - dark * 0.6) * (1 + 0.01 * warm);
  const b = (1 - dark * 0.39) * (1 - 0.1 * warm);
  return [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
}

/**
 * Everything inside is lit by the hour: wrap the island and the ground in it,
 * not the sky. By day it costs nothing.
 */
export function Lit({ atmo, children }: { atmo?: Atmosphere; children: React.ReactNode }) {
  const matrix = useMemo(() => (atmo ? lightMatrix(atmo) : null), [atmo]);
  if (!matrix) return <Group>{children}</Group>;
  return (
    <Group
      layer={
        <Paint>
          <ColorMatrix matrix={matrix} />
        </Paint>
      }
    >
      {children}
    </Group>
  );
}

interface HillProps {
  w: number;
  h: number;
  /** y of the hill's crest at the centre. */
  crestY: number;
  dark?: boolean;
  season?: Atmosphere['season'];
}

const HILL = {
  spring: ['#9BDC8E', '#74CC7C'],
  summer: ['#8FD694', '#6CC47A'],
  autumn: ['#C2C877', '#A9B95E'],
  winter: ['#EEF4F6', '#DDE8EC'],
} as const;

/** The rounded hill the sapling grows on. */
export function Hill({ w, h, crestY, dark, season = 'summer' }: HillProps) {
  const [light, deep] = HILL[season];
  const back = dark ? mixHex(light, '#16324A', 0.62) : light;
  const front = dark ? mixHex(deep, '#16324A', 0.55) : deep;
  return (
    <Group>
      <Oval x={-w * 0.55} y={crestY + 26} width={w * 1.5} height={h} color={back} />
      <Oval x={-w * 0.3} y={crestY} width={w * 1.6} height={h * 1.2} color={front} />
    </Group>
  );
}
