import { Skia, type SkPath } from '@shopify/react-native-skia';
import type { TerrainKind } from '../game/types';
import type { PlantPart } from './plants';

/**
 * Procedural sprites for animals and nature pieces. Like the plants, each one
 * is a short list of filled or stroked paths in local coordinates: the origin
 * is where the creature touches the ground, up is negative y, and it faces
 * right. `u` is the size of one unit in pixels.
 */

type Builder = ReturnType<typeof Skia.PathBuilder.Make>;
const pb = () => Skia.PathBuilder.Make();
const DEG = Math.PI / 180;
const K = 0.5523;

function part(path: SkPath, color: string, extra: Partial<PlantPart> = {}): PlantPart {
  return { path, color, wiltColor: color, ...extra };
}

/** Add an ellipse (optionally rotated) to a builder. */
function ell(b: Builder, cx: number, cy: number, rx: number, ry: number, rotDeg = 0) {
  const c = Math.cos(rotDeg * DEG);
  const s = Math.sin(rotDeg * DEG);
  const p = (x: number, y: number): [number, number] => [cx + x * c - y * s, cy + x * s + y * c];
  const [x0, y0] = p(rx, 0);
  b.moveTo(x0, y0);
  const seg = (a: [number, number], bb: [number, number], d: [number, number]) =>
    b.cubicTo(...p(...a), ...p(...bb), ...p(...d));
  seg([rx, ry * K], [rx * K, ry], [0, ry]);
  seg([-rx * K, ry], [-rx, ry * K], [-rx, 0]);
  seg([-rx, -ry * K], [-rx * K, -ry], [0, -ry]);
  seg([rx * K, -ry], [rx, -ry * K], [rx, 0]);
  b.close();
  return b;
}

const oval = (cx: number, cy: number, rx: number, ry: number, rot = 0) => ell(pb(), cx, cy, rx, ry, rot).build();

/** A leaf shape from (x0,y0) toward `deg` (0 = right, -90 = up). */
function leaf(b: Builder, x0: number, y0: number, deg: number, len: number, w: number) {
  const a = deg * DEG;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const mx = x0 + dx * len * 0.5;
  const my = y0 + dy * len * 0.5;
  b.moveTo(x0, y0);
  b.quadTo(mx - dy * w, my + dx * w, x0 + dx * len, y0 + dy * len);
  b.quadTo(mx + dy * w, my - dx * w, x0, y0);
  b.close();
  return b;
}

const leafPath = (x0: number, y0: number, deg: number, len: number, w: number) => leaf(pb(), x0, y0, deg, len, w).build();

function poly(points: [number, number][]) {
  const b = pb();
  points.forEach(([x, y], i) => (i === 0 ? b.moveTo(x, y) : b.lineTo(x, y)));
  return b.close().build();
}

function legs(xs: number[], top: number, w: number) {
  const b = pb();
  for (const x of xs) b.addRRect({ rect: { x: x - w / 2, y: top, width: w, height: -top }, rx: w / 2, ry: w / 2 });
  return b.build();
}

const DARK = '#2B2118';

export interface CreatureSprite {
  parts: PlantPart[];
  /** Extra parts for a second pose (wings up), shown alternately while flying. */
  alt?: PlantPart[];
  /** Parts only shown in the resting pose (wings folded). */
  rest?: PlantPart[];
  /** Parts that turn around a point (the sails of the windmill). */
  spin?: { parts: PlantPart[]; cx: number; cy: number };
  /** Approximate size for hit testing and shadows, in pixels. */
  width: number;
  height: number;
}

type Draw = (u: number) => Omit<CreatureSprite, 'width' | 'height'>;

const ANIMAL_SIZE: Record<string, [number, number]> = {
  rabbit: [0.5, 0.6],
  squirrel: [0.45, 0.6],
  hedgehog: [0.55, 0.3],
  fox: [0.8, 0.6],
  fox_sleep: [0.7, 0.3],
  hedgehog_ball: [0.4, 0.3],
  deer: [0.8, 1.15],
  frog: [0.4, 0.26],
  duck: [0.5, 0.34],
  fish: [0.36, 0.2],
  bird: [0.26, 0.24],
  owl: [0.28, 0.36],
};

const ANIMALS: Record<string, Draw> = {
  rabbit: (u) => {
    const fur = '#D8C6B2';
    const ears = pb();
    leaf(ears, 0.12 * u, -0.4 * u, -105, 0.25 * u, 0.045 * u);
    leaf(ears, 0.19 * u, -0.4 * u, -80, 0.24 * u, 0.045 * u);
    const inner = pb();
    leaf(inner, 0.19 * u, -0.42 * u, -80, 0.17 * u, 0.02 * u);
    return {
      parts: [
        part(oval(-0.11 * u, -0.035 * u, 0.1 * u, 0.04 * u), '#BFA992'),
        part(Skia.Path.Circle(-0.2 * u, -0.17 * u, 0.06 * u), '#FFFFFF'),
        part(oval(0, -0.17 * u, 0.2 * u, 0.15 * u), fur),
        part(ears.build(), fur),
        part(inner.build(), '#F2B8B0'),
        part(Skia.Path.Circle(0.17 * u, -0.33 * u, 0.11 * u), fur),
        part(oval(0.13 * u, -0.03 * u, 0.06 * u, 0.035 * u), '#BFA992'),
        part(Skia.Path.Circle(0.21 * u, -0.35 * u, 0.02 * u), DARK),
        part(Skia.Path.Circle(0.275 * u, -0.31 * u, 0.014 * u), '#E88F8F'),
      ],
    };
  },

  squirrel: (u) => {
    const fur = '#C97B3F';
    return {
      parts: [
        part(leafPath(-0.08 * u, -0.06 * u, -112, 0.52 * u, 0.17 * u), '#B5672C'),
        part(leafPath(-0.09 * u, -0.1 * u, -112, 0.4 * u, 0.09 * u), '#D99658'),
        part(oval(0, -0.15 * u, 0.12 * u, 0.15 * u), fur),
        part(oval(0.045 * u, -0.13 * u, 0.06 * u, 0.1 * u), '#F3DFC1'),
        part(leafPath(0.07 * u, -0.38 * u, -100, 0.1 * u, 0.03 * u), fur),
        part(Skia.Path.Circle(0.1 * u, -0.33 * u, 0.09 * u), fur),
        part(Skia.Path.Circle(0.13 * u, -0.35 * u, 0.018 * u), DARK),
        part(Skia.Path.Circle(0.185 * u, -0.31 * u, 0.013 * u), DARK),
        part(oval(0.04 * u, -0.02 * u, 0.07 * u, 0.03 * u), '#A85F2A'),
      ],
    };
  },

  hedgehog: (u) => {
    const spikes: [number, number][] = [];
    const n = 11;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * (1 - i / n);
      const r = (i % 2 ? 0.27 : 0.2) * u;
      spikes.push([-0.05 * u + Math.cos(a) * r * 0.95, -0.02 * u - Math.sin(a) * r * 0.9]);
    }
    return {
      parts: [
        part(poly(spikes), '#6B4F3A'),
        part(oval(-0.05 * u, -0.08 * u, 0.2 * u, 0.09 * u), '#7C5C44'),
        part(oval(0.16 * u, -0.075 * u, 0.11 * u, 0.07 * u), '#EBCFAB'),
        part(Skia.Path.Circle(0.265 * u, -0.07 * u, 0.02 * u), DARK),
        part(Skia.Path.Circle(0.17 * u, -0.1 * u, 0.015 * u), DARK),
        part(oval(0.08 * u, -0.01 * u, 0.04 * u, 0.02 * u), '#C9A77F'),
        part(oval(-0.12 * u, -0.01 * u, 0.04 * u, 0.02 * u), '#C9A77F'),
      ],
    };
  },

  fox: (u) => {
    const fur = '#E8833A';
    const ears = pb();
    ears.moveTo(0.19 * u, -0.43 * u).lineTo(0.21 * u, -0.58 * u).lineTo(0.28 * u, -0.45 * u).close();
    ears.moveTo(0.28 * u, -0.45 * u).lineTo(0.34 * u, -0.57 * u).lineTo(0.36 * u, -0.42 * u).close();
    return {
      parts: [
        part(leafPath(-0.2 * u, -0.22 * u, 195, 0.36 * u, 0.12 * u), fur),
        part(Skia.Path.Circle(-0.52 * u, -0.3 * u, 0.055 * u), '#FFF6EA'),
        part(legs([-0.17 * u, -0.1 * u, 0.1 * u, 0.17 * u], -0.16 * u, 0.045 * u), '#5A3A28'),
        part(oval(0, -0.23 * u, 0.25 * u, 0.115 * u), fur),
        part(oval(0.17 * u, -0.2 * u, 0.07 * u, 0.085 * u), '#FFF6EA'),
        part(ears.build(), fur),
        part(Skia.Path.Circle(0.27 * u, -0.36 * u, 0.1 * u), fur),
        part(leafPath(0.3 * u, -0.33 * u, 14, 0.15 * u, 0.045 * u), '#FFF6EA'),
        part(Skia.Path.Circle(0.445 * u, -0.3 * u, 0.018 * u), DARK),
        part(Skia.Path.Circle(0.3 * u, -0.38 * u, 0.018 * u), DARK),
      ],
    };
  },

  // The fox at noon: curled up, nose under its tail.
  fox_sleep: (u) => {
    const fur = '#E8833A';
    const ears = pb();
    ears.moveTo(0.1 * u, -0.2 * u).lineTo(0.13 * u, -0.31 * u).lineTo(0.19 * u, -0.21 * u).close();
    ears.moveTo(0.19 * u, -0.2 * u).lineTo(0.25 * u, -0.29 * u).lineTo(0.27 * u, -0.17 * u).close();
    return {
      parts: [
        part(oval(0, -0.12 * u, 0.3 * u, 0.13 * u), fur),
        part(oval(-0.04 * u, -0.17 * u, 0.2 * u, 0.07 * u), '#F09A55'),
        part(ears.build(), fur),
        part(Skia.Path.Circle(0.18 * u, -0.13 * u, 0.095 * u), fur),
        part(leafPath(0.3 * u, -0.03 * u, 178, 0.5 * u, 0.085 * u), fur),
        part(Skia.Path.Circle(-0.19 * u, -0.035 * u, 0.05 * u), '#FFF6EA'),
        part(pb().moveTo(0.13 * u, -0.13 * u).quadTo(0.16 * u, -0.11 * u, 0.19 * u, -0.13 * u).build(), DARK, { stroke: Math.max(1, 0.014 * u) }),
      ],
    };
  },

  // A startled hedgehog: all spikes.
  hedgehog_ball: (u) => {
    const spikes: [number, number][] = [];
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n;
      const r = (i % 2 ? 0.2 : 0.145) * u;
      spikes.push([Math.cos(a) * r, -0.15 * u + Math.sin(a) * r * 0.9]);
    }
    return { parts: [part(poly(spikes), '#6B4F3A'), part(Skia.Path.Circle(0, -0.15 * u, 0.12 * u), '#7C5C44')] };
  },

  deer: (u) => {
    const fur = '#B98558';
    const antler = pb()
      .moveTo(0.33 * u, -0.95 * u)
      .lineTo(0.28 * u, -1.13 * u)
      .moveTo(0.3 * u, -1.04 * u)
      .lineTo(0.22 * u, -1.1 * u)
      .moveTo(0.37 * u, -0.95 * u)
      .lineTo(0.4 * u, -1.12 * u)
      .moveTo(0.39 * u, -1.04 * u)
      .lineTo(0.46 * u, -1.09 * u)
      .build();
    const spots = pb();
    spots.addCircle(-0.12 * u, -0.6 * u, 0.022 * u).addCircle(-0.02 * u, -0.63 * u, 0.02 * u).addCircle(0.08 * u, -0.6 * u, 0.02 * u);
    return {
      parts: [
        part(legs([-0.2 * u, -0.12 * u, 0.13 * u, 0.2 * u], -0.48 * u, 0.04 * u), '#8A5F3C'),
        part(leafPath(-0.27 * u, -0.56 * u, 200, 0.1 * u, 0.04 * u), '#FFF6EA'),
        part(oval(0, -0.53 * u, 0.3 * u, 0.15 * u), fur),
        part(poly([[0.17 * u, -0.6 * u], [0.3 * u, -0.5 * u], [0.38 * u, -0.82 * u], [0.28 * u, -0.87 * u]]), fur),
        part(spots.build(), '#F1DCC2'),
        part(antler, '#7A5A3A', { stroke: Math.max(1.5, 0.025 * u) }),
        part(leafPath(0.29 * u, -0.92 * u, -150, 0.12 * u, 0.035 * u), '#A87449'),
        part(oval(0.37 * u, -0.87 * u, 0.1 * u, 0.065 * u, 14), fur),
        part(Skia.Path.Circle(0.46 * u, -0.85 * u, 0.02 * u), DARK),
        part(Skia.Path.Circle(0.37 * u, -0.89 * u, 0.017 * u), DARK),
      ],
    };
  },

  frog: (u) => {
    const eyes = pb();
    eyes.addCircle(-0.03 * u, -0.19 * u, 0.05 * u).addCircle(0.08 * u, -0.19 * u, 0.05 * u);
    const whites = pb();
    whites.addCircle(-0.03 * u, -0.195 * u, 0.032 * u).addCircle(0.08 * u, -0.195 * u, 0.032 * u);
    const pupils = pb();
    pupils.addCircle(-0.02 * u, -0.195 * u, 0.016 * u).addCircle(0.09 * u, -0.195 * u, 0.016 * u);
    const feet = pb();
    ell(feet, -0.15 * u, -0.03 * u, 0.08 * u, 0.04 * u, -15);
    ell(feet, 0.14 * u, -0.025 * u, 0.06 * u, 0.03 * u, 10);
    return {
      parts: [
        part(feet.build(), '#4E9B4A'),
        part(oval(0, -0.09 * u, 0.17 * u, 0.1 * u), '#6BBF59'),
        part(oval(0.03 * u, -0.06 * u, 0.11 * u, 0.055 * u), '#CDE8A6'),
        part(eyes.build(), '#6BBF59'),
        part(whites.build(), '#FFFFFF'),
        part(pupils.build(), DARK),
      ],
    };
  },

  duck: (u) => ({
    parts: [
      part(oval(0, 0, 0.27 * u, 0.055 * u), '#FFFFFF', { opacity: 0.45 }),
      part(leafPath(-0.16 * u, -0.1 * u, 212, 0.12 * u, 0.04 * u), '#E8E0D2'),
      part(oval(0, -0.08 * u, 0.2 * u, 0.1 * u), '#F6F1E7'),
      part(oval(-0.03 * u, -0.1 * u, 0.11 * u, 0.06 * u), '#D9CFBE'),
      part(Skia.Path.Circle(0.16 * u, -0.19 * u, 0.045 * u), '#FFFFFF'),
      part(Skia.Path.Circle(0.17 * u, -0.25 * u, 0.075 * u), '#2F8F5B'),
      part(leafPath(0.23 * u, -0.24 * u, 6, 0.11 * u, 0.03 * u), '#F2A33A'),
      part(Skia.Path.Circle(0.19 * u, -0.27 * u, 0.016 * u), DARK),
    ],
  }),

  fish: (u) => ({
    parts: [
      part(poly([[-0.1 * u, 0], [-0.19 * u, -0.07 * u], [-0.19 * u, 0.07 * u]]), '#E0742A'),
      part(leafPath(-0.12 * u, 0, 0, 0.28 * u, 0.09 * u), '#F28C38'),
      part(leafPath(-0.02 * u, 0.01 * u, 0, 0.14 * u, 0.04 * u), '#FFD9A8', { opacity: 0.8 }),
      part(Skia.Path.Circle(0.09 * u, -0.015 * u, 0.016 * u), DARK),
    ],
  }),

  bird: (u) => ({
    parts: [
      part(leafPath(-0.07 * u, -0.08 * u, 170, 0.12 * u, 0.03 * u), '#2F7FC1'),
      part(oval(0, -0.08 * u, 0.095 * u, 0.075 * u), '#4A9FE0'),
      part(oval(0.025 * u, -0.06 * u, 0.06 * u, 0.05 * u), '#FCE9C8'),
      part(Skia.Path.Circle(0.07 * u, -0.15 * u, 0.055 * u), '#4A9FE0'),
      part(poly([[0.115 * u, -0.16 * u], [0.17 * u, -0.145 * u], [0.115 * u, -0.13 * u]]), '#F2A33A'),
      part(Skia.Path.Circle(0.085 * u, -0.16 * u, 0.014 * u), DARK),
    ],
    rest: [part(leafPath(0.02 * u, -0.1 * u, 165, 0.12 * u, 0.04 * u), '#2F7FC1')],
    alt: [part(leafPath(0, -0.1 * u, -115, 0.17 * u, 0.05 * u), '#2F7FC1')],
  }),

  owl: (u) => {
    const tufts = pb();
    tufts.moveTo(-0.1 * u, -0.27 * u).lineTo(-0.11 * u, -0.37 * u).lineTo(-0.04 * u, -0.3 * u).close();
    tufts.moveTo(0.1 * u, -0.27 * u).lineTo(0.11 * u, -0.37 * u).lineTo(0.04 * u, -0.3 * u).close();
    const rims = pb();
    rims.addCircle(-0.048 * u, -0.22 * u, 0.05 * u).addCircle(0.048 * u, -0.22 * u, 0.05 * u);
    const irises = pb();
    irises.addCircle(-0.048 * u, -0.22 * u, 0.034 * u).addCircle(0.048 * u, -0.22 * u, 0.034 * u);
    const pupils = pb();
    pupils.addCircle(-0.048 * u, -0.22 * u, 0.017 * u).addCircle(0.048 * u, -0.22 * u, 0.017 * u);
    return {
      parts: [
        part(tufts.build(), '#6E5238'),
        part(oval(0, -0.16 * u, 0.12 * u, 0.16 * u), '#8A6B4A'),
        part(oval(0, -0.1 * u, 0.075 * u, 0.09 * u), '#D8C2A0'),
        part(rims.build(), '#F3E7CF'),
        part(irises.build(), '#F5C542'),
        part(pupils.build(), DARK),
        part(poly([[-0.015 * u, -0.185 * u], [0.015 * u, -0.185 * u], [0, -0.15 * u]]), '#E0962E'),
      ],
    };
  },
};

const TERRAIN: Record<TerrainKind, Draw> = {
  water: (u) => ({
    // Only used as an icon: on the island, water is drawn as part of the ground.
    parts: [
      part(poly([[0, -0.5 * u], [0.42 * u, -0.29 * u], [0, -0.08 * u], [-0.42 * u, -0.29 * u]]), '#3FA9E0'),
      part(poly([[0, -0.44 * u], [0.3 * u, -0.29 * u], [0, -0.14 * u], [-0.3 * u, -0.29 * u]]), '#6CCBF5'),
      part(oval(-0.06 * u, -0.31 * u, 0.1 * u, 0.02 * u), '#FFFFFF', { opacity: 0.8 }),
      part(oval(0.1 * u, -0.25 * u, 0.06 * u, 0.014 * u), '#FFFFFF', { opacity: 0.7 }),
    ],
  }),

  rock: (u) => ({
    parts: [
      part(poly([[-0.3 * u, 0], [-0.26 * u, -0.2 * u], [-0.08 * u, -0.36 * u], [0.14 * u, -0.3 * u], [0.24 * u, -0.12 * u], [0.2 * u, 0]]), '#8D949B'),
      part(poly([[-0.26 * u, -0.2 * u], [-0.08 * u, -0.36 * u], [0.14 * u, -0.3 * u], [0.02 * u, -0.18 * u]]), '#BFC5CA'),
      part(poly([[0.02 * u, -0.18 * u], [0.14 * u, -0.3 * u], [0.24 * u, -0.12 * u], [0.2 * u, 0], [0.04 * u, 0]]), '#737A81'),
      part(poly([[0.12 * u, 0], [0.16 * u, -0.13 * u], [0.3 * u, -0.15 * u], [0.38 * u, -0.05 * u], [0.36 * u, 0]]), '#9AA1A8'),
      part(poly([[0.16 * u, -0.13 * u], [0.3 * u, -0.15 * u], [0.25 * u, -0.07 * u]]), '#C9CED2'),
      part(oval(-0.22 * u, -0.02 * u, 0.09 * u, 0.035 * u), '#6DBF6A'),
    ],
  }),

  log: (u) => {
    const body = pb()
      .addRRect({ rect: { x: -0.36 * u, y: -0.22 * u, width: 0.62 * u, height: 0.2 * u }, rx: 0.09 * u, ry: 0.09 * u })
      .build();
    const bark = pb()
      .moveTo(-0.28 * u, -0.16 * u)
      .lineTo(-0.08 * u, -0.16 * u)
      .moveTo(-0.2 * u, -0.08 * u)
      .lineTo(0.08 * u, -0.08 * u)
      .build();
    const cap = pb();
    cap.addCircle(-0.15 * u, -0.27 * u, 0.045 * u);
    return {
      parts: [
        part(body, '#8A5A3C'),
        part(bark, '#6B442C', { stroke: Math.max(1, 0.02 * u), opacity: 0.8 }),
        part(oval(0.26 * u, -0.12 * u, 0.075 * u, 0.1 * u), '#C69A6D'),
        part(oval(0.265 * u, -0.12 * u, 0.045 * u, 0.065 * u), '#3B2618'),
        part(oval(-0.05 * u, -0.215 * u, 0.16 * u, 0.035 * u), '#6DBF6A'),
        part(legs([-0.15 * u], -0.25 * u, 0.025 * u), '#F6EBD8'),
        part(cap.build(), '#E5383B'),
      ],
    };
  },

  hive: (u) => {
    const skep = pb();
    const rings: [number, number][] = [[0.2, -0.26], [0.18, -0.34], [0.15, -0.42], [0.1, -0.49]];
    for (const [w, y] of rings) ell(skep, 0, y * u, w * u, 0.055 * u);
    const bands = pb();
    for (const [w, y] of rings.slice(0, 3)) bands.moveTo(-w * u * 0.9, (y - 0.04) * u).lineTo(w * u * 0.9, (y - 0.04) * u);
    return {
      parts: [
        part(legs([-0.14 * u, 0.14 * u], -0.2 * u, 0.04 * u), '#7A5230'),
        part(pb().addRRect({ rect: { x: -0.24 * u, y: -0.23 * u, width: 0.48 * u, height: 0.05 * u }, rx: 0.02 * u, ry: 0.02 * u }).build(), '#8A5A3C'),
        part(skep.build(), '#E8B84A'),
        part(bands.build(), '#C8922B', { stroke: Math.max(1, 0.018 * u), opacity: 0.9 }),
        part(oval(0, -0.28 * u, 0.04 * u, 0.035 * u), '#3B2618'),
      ],
    };
  },

  campfire: (u) => {
    const stones = pb();
    const pts: [number, number][] = [[-0.24, -0.03], [-0.13, 0.03], [0.02, 0.05], [0.16, 0.02], [0.25, -0.04]];
    for (const [x, y] of pts) ell(stones, x * u, y * u, 0.07 * u, 0.045 * u);
    const wood = pb()
      .moveTo(-0.17 * u, -0.02 * u)
      .lineTo(0.13 * u, -0.14 * u)
      .moveTo(0.17 * u, -0.02 * u)
      .lineTo(-0.13 * u, -0.14 * u)
      .build();
    const outer = pb();
    leaf(outer, 0, -0.06 * u, -90, 0.4 * u, 0.13 * u);
    leaf(outer, -0.07 * u, -0.06 * u, -105, 0.26 * u, 0.08 * u);
    leaf(outer, 0.07 * u, -0.06 * u, -75, 0.28 * u, 0.08 * u);
    return {
      parts: [
        part(wood, '#6B442C', { stroke: Math.max(2, 0.06 * u) }),
        part(stones.build(), '#8D949B'),
      ],
      // The flame is drawn separately so it can flicker.
      alt: [
        part(Skia.Path.Circle(0, -0.2 * u, 0.3 * u), '#FFB347', { blur: 0.14 * u, opacity: 0.45 }),
        part(outer.build(), '#FF8A3D'),
        part(leafPath(0, -0.06 * u, -90, 0.24 * u, 0.07 * u), '#FFD866'),
      ],
    };
  },
  arch: (u) => {
    const stone = pb()
      .moveTo(-0.3 * u, 0)
      .lineTo(-0.3 * u, -0.42 * u)
      .cubicTo(-0.3 * u, -0.7 * u, 0.3 * u, -0.7 * u, 0.3 * u, -0.42 * u)
      .lineTo(0.3 * u, 0)
      .lineTo(0.15 * u, 0)
      .lineTo(0.15 * u, -0.38 * u)
      .cubicTo(0.15 * u, -0.52 * u, -0.15 * u, -0.52 * u, -0.15 * u, -0.38 * u)
      .lineTo(-0.15 * u, 0)
      .close()
      .build();
    const joints = pb()
      .moveTo(-0.3 * u, -0.14 * u).lineTo(-0.15 * u, -0.14 * u)
      .moveTo(-0.3 * u, -0.3 * u).lineTo(-0.15 * u, -0.3 * u)
      .moveTo(0.3 * u, -0.14 * u).lineTo(0.15 * u, -0.14 * u)
      .moveTo(0.3 * u, -0.3 * u).lineTo(0.15 * u, -0.3 * u)
      .moveTo(0, -0.63 * u).lineTo(0, -0.49 * u)
      .build();
    return {
      parts: [
        part(stone, '#A9AFB5'),
        part(poly([[-0.3 * u, 0], [-0.3 * u, -0.42 * u], [-0.24 * u, -0.5 * u], [-0.24 * u, 0]]), '#C9CED2'),
        part(joints, '#737A81', { stroke: Math.max(1, 0.018 * u), opacity: 0.8 }),
        part(poly([[-0.05 * u, -0.66 * u], [0.05 * u, -0.66 * u], [0.035 * u, -0.5 * u], [-0.035 * u, -0.5 * u]]), '#E8C36A'),
        part(oval(-0.24 * u, -0.01 * u, 0.1 * u, 0.035 * u), '#6DBF6A'),
        part(oval(0.25 * u, -0.01 * u, 0.08 * u, 0.03 * u), '#6DBF6A'),
      ],
    };
  },

  windmill: (u) => {
    const blades = pb();
    for (const deg of [20, 110, 200, 290]) {
      const a = deg * DEG;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const at = (d: number, w: number): [number, number] => [d * c - w * sn, -0.62 * u + d * sn + w * c];
      const pts = [at(0.06 * u, 0), at(0.44 * u, 0), at(0.44 * u, 0.1 * u), at(0.1 * u, 0.1 * u)];
      blades.moveTo(...pts[0]);
      for (const q of pts.slice(1)) blades.lineTo(...q);
      blades.close();
    }
    return {
      parts: [
        part(poly([[-0.2 * u, 0], [-0.12 * u, -0.6 * u], [0.12 * u, -0.6 * u], [0.2 * u, 0]]), '#F1E6D0'),
        part(poly([[0.02 * u, 0], [0.04 * u, -0.6 * u], [0.12 * u, -0.6 * u], [0.2 * u, 0]]), '#D9CBB0'),
        part(poly([[-0.16 * u, -0.58 * u], [0, -0.82 * u], [0.16 * u, -0.58 * u]]), '#C4553B'),
        part(pb().addRRect({ rect: { x: -0.05 * u, y: -0.16 * u, width: 0.1 * u, height: 0.16 * u }, rx: 0.05 * u, ry: 0.05 * u }).build(), '#7A5230'),
        part(oval(0, -0.4 * u, 0.04 * u, 0.05 * u), '#6FB7D9'),
      ],
      spin: {
        parts: [part(blades.build(), '#FFFFFF', { opacity: 0.95 }), part(Skia.Path.Circle(0, -0.62 * u, 0.04 * u), '#7A5230')],
        cx: 0,
        cy: -0.62 * u,
      },
    };
  },

  lighthouse: (u) => ({
    parts: [
      part(poly([[-0.17 * u, 0], [-0.1 * u, -0.72 * u], [0.1 * u, -0.72 * u], [0.17 * u, 0]]), '#F6F1E6'),
      part(poly([[-0.155 * u, -0.16 * u], [-0.135 * u, -0.36 * u], [0.135 * u, -0.36 * u], [0.155 * u, -0.16 * u]]), '#D9463E'),
      part(poly([[-0.118 * u, -0.54 * u], [-0.1 * u, -0.72 * u], [0.1 * u, -0.72 * u], [0.118 * u, -0.54 * u]]), '#D9463E'),
      part(poly([[0.03 * u, 0], [0.02 * u, -0.72 * u], [0.1 * u, -0.72 * u], [0.17 * u, 0]]), '#1F3D2B', { opacity: 0.1 }),
      part(pb().addRRect({ rect: { x: -0.14 * u, y: -0.76 * u, width: 0.28 * u, height: 0.045 * u }, rx: 0.02 * u, ry: 0.02 * u }).build(), '#4A5560'),
      part(pb().addRect({ x: -0.08 * u, y: -0.9 * u, width: 0.16 * u, height: 0.14 * u }).build(), '#FFE08A'),
      part(poly([[-0.11 * u, -0.9 * u], [0, -1.02 * u], [0.11 * u, -0.9 * u]]), '#4A5560'),
      part(pb().addRRect({ rect: { x: -0.04 * u, y: -0.13 * u, width: 0.08 * u, height: 0.13 * u }, rx: 0.04 * u, ry: 0.04 * u }).build(), '#7A5230'),
    ],
    // The lamp glows (and breathes like the campfire).
    alt: [part(Skia.Path.Circle(0, -0.83 * u, 0.2 * u), '#FFE08A', { blur: 0.12 * u, opacity: 0.55 })],
  }),
};

/** What is left of a landmark after the streak that built it broke. */
const RUINS: Record<string, Draw> = {
  arch: (u) => ({
    parts: [
      part(poly([[-0.3 * u, 0], [-0.3 * u, -0.34 * u], [-0.22 * u, -0.4 * u], [-0.15 * u, -0.3 * u], [-0.15 * u, 0]]), '#8D949B'),
      part(poly([[0.15 * u, 0], [0.15 * u, -0.16 * u], [0.24 * u, -0.22 * u], [0.3 * u, -0.14 * u], [0.3 * u, 0]]), '#8D949B'),
      part(poly([[-0.06 * u, 0], [-0.04 * u, -0.08 * u], [0.06 * u, -0.09 * u], [0.09 * u, 0]]), '#737A81'),
      part(oval(-0.22 * u, -0.01 * u, 0.12 * u, 0.035 * u), '#7C9A63'),
      part(oval(0.2 * u, -0.2 * u, 0.06 * u, 0.025 * u), '#7C9A63'),
    ],
  }),
  windmill: (u) => ({
    parts: [
      part(poly([[-0.2 * u, 0], [-0.15 * u, -0.38 * u], [-0.04 * u, -0.3 * u], [0.06 * u, -0.42 * u], [0.15 * u, -0.34 * u], [0.2 * u, 0]]), '#CFC4AC'),
      part(poly([[0.04 * u, 0], [0.06 * u, -0.42 * u], [0.15 * u, -0.34 * u], [0.2 * u, 0]]), '#B5A98F'),
      part(pb().moveTo(0.22 * u, -0.02 * u).lineTo(0.46 * u, -0.1 * u).build(), '#E9E4DA', { stroke: Math.max(2, 0.05 * u) }),
      part(pb().addRRect({ rect: { x: -0.05 * u, y: -0.16 * u, width: 0.1 * u, height: 0.16 * u }, rx: 0.05 * u, ry: 0.05 * u }).build(), '#4E3A26'),
      part(oval(-0.2 * u, -0.01 * u, 0.1 * u, 0.03 * u), '#7C9A63'),
    ],
  }),
  lighthouse: (u) => ({
    parts: [
      part(poly([[-0.17 * u, 0], [-0.13 * u, -0.4 * u], [-0.03 * u, -0.32 * u], [0.05 * u, -0.46 * u], [0.13 * u, -0.36 * u], [0.17 * u, 0]]), '#D8D2C4'),
      part(poly([[-0.155 * u, -0.16 * u], [-0.14 * u, -0.3 * u], [0.14 * u, -0.3 * u], [0.155 * u, -0.16 * u]]), '#A8574F'),
      part(poly([[0.2 * u, 0], [0.22 * u, -0.07 * u], [0.32 * u, -0.08 * u], [0.36 * u, 0]]), '#B9B3A5'),
      part(pb().addRRect({ rect: { x: -0.04 * u, y: -0.13 * u, width: 0.08 * u, height: 0.13 * u }, rx: 0.04 * u, ry: 0.04 * u }).build(), '#4E3A26'),
      part(oval(-0.18 * u, -0.01 * u, 0.1 * u, 0.03 * u), '#7C9A63'),
    ],
  }),
};

/** What is left of a plant that died: a stump for trees, dry stalks for everything smaller. */
const REMAINS: Record<string, Draw> = {
  stump: (u) => ({
    parts: [
      part(poly([[-0.17 * u, 0], [-0.12 * u, -0.2 * u], [0.12 * u, -0.2 * u], [0.17 * u, 0]]), '#7A5A40'),
      part(poly([[0.02 * u, 0], [0.03 * u, -0.2 * u], [0.12 * u, -0.2 * u], [0.17 * u, 0]]), '#63472F'),
      part(oval(0, -0.2 * u, 0.12 * u, 0.045 * u), '#C9A77C'),
      part(oval(0, -0.2 * u, 0.06 * u, 0.022 * u), '#A9855C'),
      part(pb().moveTo(-0.17 * u, 0).lineTo(-0.26 * u, 0.02 * u).moveTo(0.17 * u, 0).lineTo(0.25 * u, 0.02 * u).build(), '#63472F', { stroke: Math.max(2, 0.04 * u) }),
    ],
  }),
  stalks: (u) => ({
    parts: [
      part(
        pb()
          .moveTo(0, 0).quadTo(0.03 * u, -0.14 * u, -0.05 * u, -0.26 * u)
          .moveTo(-0.07 * u, 0).quadTo(-0.12 * u, -0.08 * u, -0.17 * u, -0.13 * u)
          .moveTo(0.07 * u, 0).quadTo(0.12 * u, -0.1 * u, 0.15 * u, -0.18 * u)
          .build(),
        '#8C7A58',
        { stroke: Math.max(1.5, 0.03 * u) },
      ),
      part(leafPath(-0.05 * u, -0.26 * u, 160, 0.09 * u, 0.03 * u), '#A8946A'),
      part(leafPath(0.15 * u, -0.18 * u, 20, 0.08 * u, 0.025 * u), '#A8946A'),
      part(oval(0, 0, 0.11 * u, 0.03 * u), '#9A8A63', { opacity: 0.7 }),
    ],
  }),
  // The dead twig a withered session leaves behind for a day.
  twig: (u) => ({
    parts: [
      part(
        pb()
          .moveTo(0, 0).quadTo(-0.02 * u, -0.16 * u, 0.03 * u, -0.32 * u)
          .moveTo(0.005 * u, -0.14 * u).lineTo(-0.1 * u, -0.24 * u)
          .moveTo(0.015 * u, -0.22 * u).lineTo(0.12 * u, -0.3 * u)
          .build(),
        '#6B5540',
        { stroke: Math.max(1.5, 0.032 * u) },
      ),
      part(leafPath(-0.1 * u, -0.24 * u, 215, 0.08 * u, 0.028 * u), '#9A8A63'),
      part(oval(0, 0, 0.08 * u, 0.025 * u), '#5E4B38', { opacity: 0.5 }),
    ],
  }),
};

const cache = new Map<string, CreatureSprite>();

/** Remains of a dead plant ('stump' or 'stalks') or the twig of a withered session. */
export function remainsSprite(kind: 'stump' | 'stalks' | 'twig', unit: number): CreatureSprite {
  const u = Math.round(unit * 2) / 2;
  const key = `r:${kind}@${u}`;
  let s = cache.get(key);
  if (!s) {
    s = { ...REMAINS[kind](u), width: (kind === 'stump' ? 0.5 : 0.34) * u, height: 0.3 * u };
    cache.set(key, s);
  }
  return s;
}

export function animalSprite(id: string, unit: number): CreatureSprite | null {
  const draw = ANIMALS[id];
  if (!draw) return null;
  const u = Math.round(unit * 2) / 2;
  const key = `a:${id}@${u}`;
  let s = cache.get(key);
  if (!s) {
    const [w, h] = ANIMAL_SIZE[id] ?? [0.5, 0.5];
    s = { ...draw(u), width: w * u, height: h * u };
    cache.set(key, s);
  }
  return s;
}

export function hasAnimalSprite(id: string) {
  return id in ANIMALS;
}

export function terrainSprite(kind: TerrainKind, unit: number, ruined = false): CreatureSprite {
  const u = Math.round(unit * 2) / 2;
  const draw = ruined && RUINS[kind] ? RUINS[kind] : TERRAIN[kind];
  const key = `t:${kind}${draw === TERRAIN[kind] ? '' : ':ruin'}@${u}`;
  let s = cache.get(key);
  if (!s) {
    s = { ...draw(u), width: 0.7 * u, height: 0.55 * u };
    cache.set(key, s);
  }
  return s;
}
