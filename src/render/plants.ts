import { Skia, type SkPath } from '@shopify/react-native-skia';
import { mulberry32, hashString } from '../game/rng';
import { getSpecies, type Species } from '../game/species';
import type { Season } from '../game/atmosphere';
import { darken, lighten, mixHex, wilted } from '../ui/theme';

/**
 * Every plant is drawn procedurally from a handful of filled or stroked paths.
 * Coordinates are local: the origin is where the plant meets the ground, and
 * up is negative y. `u` is the size of one "size unit" in pixels.
 */
export interface PlantPart {
  path: SkPath;
  color: string;
  wiltColor: string;
  /** Stroke width; undefined means the path is filled. */
  stroke?: number;
  opacity?: number;
  /** Soft glow drawn with a blur (legendary plants). */
  blur?: number;
}

export interface PlantSpriteData {
  parts: PlantPart[];
  /** Height in pixels (for layout). */
  height: number;
  /** Half width in pixels (for layout and the ground shadow). */
  halfWidth: number;
}

const pb = () => Skia.PathBuilder.Make();

function part(path: SkPath, color: string, extra: Partial<PlantPart> = {}): PlantPart {
  return { path, color, wiltColor: wilted(color), ...extra };
}

function circle(x: number, y: number, r: number): SkPath {
  return Skia.Path.Circle(x, y, r);
}

/** A leaf / petal shape from (x0,y0) toward angle `a` with length `len` and half width `w`. */
function addLeaf(b: ReturnType<typeof pb>, x0: number, y0: number, a: number, len: number, w: number) {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const px = -dy;
  const py = dx;
  const mx = x0 + dx * len * 0.5;
  const my = y0 + dy * len * 0.5;
  const tx = x0 + dx * len;
  const ty = y0 + dy * len;
  b.moveTo(x0, y0);
  b.quadTo(mx + px * w, my + py * w, tx, ty);
  b.quadTo(mx - px * w, my - py * w, x0, y0);
  b.close();
}

function stemPath(h: number, lean: number): SkPath {
  return pb().moveTo(0, 0).quadTo(lean, -h * 0.5, 0, -h).build();
}

const DEG = Math.PI / 180;

function flower(s: Species, u: number): PlantPart[] {
  const h = u * s.size;
  const parts: PlantPart[] = [];
  const cupped = s.detail <= 5;
  const petalLen = u * (cupped ? 0.42 : 0.3) * Math.sqrt(s.size);
  const cy = -h;

  if (s.glow) parts.push(part(circle(0, cy, petalLen * 1.7), s.primary, { blur: petalLen * 0.6, opacity: 0.55 }));
  parts.push(part(stemPath(h, u * 0.08), s.stem, { stroke: Math.max(2, u * 0.07) }));

  const leaves = pb();
  addLeaf(leaves, 0, -h * 0.3, -35 * DEG, u * 0.36, u * 0.13);
  addLeaf(leaves, 0, -h * 0.45, -145 * DEG, u * 0.32, u * 0.12);
  parts.push(part(leaves.build(), lighten(s.stem, 0.12)));

  const petals = pb();
  if (cupped) {
    const spread = s.detail * 11;
    for (let i = 0; i < s.detail; i++) {
      const a = -90 + (s.detail === 1 ? 0 : -spread + (2 * spread * i) / (s.detail - 1));
      addLeaf(petals, 0, cy + petalLen * 0.25, a * DEG, petalLen * 1.15, petalLen * 0.42);
    }
    parts.push(part(petals.build(), s.primary));
    const inner = pb();
    addLeaf(inner, 0, cy + petalLen * 0.25, -90 * DEG, petalLen * 0.85, petalLen * 0.3);
    parts.push(part(inner.build(), lighten(s.primary, 0.25)));
  } else {
    for (let i = 0; i < s.detail; i++) {
      const a = (i / s.detail) * Math.PI * 2 - Math.PI / 2;
      addLeaf(petals, 0, cy, a, petalLen, petalLen * 0.36);
    }
    parts.push(part(petals.build(), s.primary));
    parts.push(part(circle(0, cy, petalLen * 0.36), s.accent));
    parts.push(part(circle(-petalLen * 0.1, cy - petalLen * 0.1, petalLen * 0.14), lighten(s.accent, 0.35), { opacity: 0.8 }));
  }
  return parts;
}

function fern(s: Species, u: number): PlantPart[] {
  const h = u * s.size;
  const parts: PlantPart[] = [];
  const n = s.detail;

  if (s.id === 'clover') {
    const stalks = pb();
    const heads = pb();
    for (let i = 0; i < 3; i++) {
      const a = (-90 + (i - 1) * 32) * DEG;
      const len = h * (i === 1 ? 1 : 0.8);
      const tx = Math.cos(a) * len;
      const ty = Math.sin(a) * len;
      stalks.moveTo(0, 0).quadTo(tx * 0.3, ty * 0.6, tx, ty);
      const r = u * 0.13;
      for (let k = 0; k < 3; k++) {
        const b = a + ((k - 1) * 120 + 0) * DEG;
        heads.addCircle(tx + Math.cos(b) * r * 0.85, ty + Math.sin(b) * r * 0.85, r);
      }
    }
    parts.push(part(stalks.build(), s.stem, { stroke: Math.max(1.5, u * 0.05) }));
    parts.push(part(heads.build(), s.primary));
    return parts;
  }

  if (s.id === 'lavender') {
    const stalks = pb();
    const spikes = pb();
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0 : i / (n - 1) - 0.5;
      const a = (-90 + f * 60) * DEG;
      const len = h * (1 - Math.abs(f) * 0.35);
      const tx = Math.cos(a) * len;
      const ty = Math.sin(a) * len;
      stalks.moveTo(0, 0).quadTo(tx * 0.2, ty * 0.6, tx, ty);
      addLeaf(spikes, tx - Math.cos(a) * len * 0.42, ty - Math.sin(a) * len * 0.42, a, len * 0.5, u * 0.07);
    }
    parts.push(part(stalks.build(), s.stem, { stroke: Math.max(1.5, u * 0.045) }));
    parts.push(part(spikes.build(), s.primary));
    return parts;
  }

  const back = pb();
  const front = pb();
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1) - 0.5;
    const a = (-90 + f * 130) * DEG;
    const len = h * (1 - Math.abs(f) * 0.45);
    addLeaf(i % 2 === 0 ? back : front, 0, 0, a, len, u * 0.16);
  }
  parts.push(part(back.build(), s.primary));
  parts.push(part(front.build(), s.accent));
  return parts;
}

function tree(s: Species, u: number, season: Season): PlantPart[] {
  const h = u * s.size;
  const parts: PlantPart[] = [];
  const trunkH = h * 0.5;
  const tw = u * 0.13;
  const crownR = h * 0.3;
  const cy = -trunkH - crownR * 0.75;
  const rand = mulberry32(hashString(s.id));

  if (s.glow) parts.push(part(circle(0, cy, crownR * 1.9), s.primary, { blur: crownR * 0.7, opacity: 0.5 }));

  const trunk = pb()
    .moveTo(-tw, 0)
    .quadTo(-tw * 0.5, -trunkH * 0.5, -tw * 0.6, -trunkH)
    .lineTo(tw * 0.6, -trunkH)
    .quadTo(tw * 0.5, -trunkH * 0.5, tw, 0)
    .close()
    .build();
  parts.push(part(trunk, s.stem));

  const shade = pb();
  const crown = pb();
  const lobes = s.detail + 2;
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + 0.4;
    const r = crownR * (0.62 + rand() * 0.18);
    const x = Math.cos(a) * crownR * 0.62;
    const y = cy + Math.sin(a) * crownR * 0.45;
    shade.addCircle(x + u * 0.03, y + u * 0.05, r);
    crown.addCircle(x, y, r);
  }
  crown.addCircle(0, cy, crownR * 0.8);
  parts.push(part(shade.build(), darken(s.primary, 0.16)));
  parts.push(part(crown.build(), s.primary));

  if (season === 'winter' && !s.glow) {
    // Snow lies on the top of the crown.
    const snow = pb();
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * crownR * 0.42;
      snow.addCircle(x, cy - crownR * (0.62 - Math.abs(i - 1.5) * 0.14), crownR * 0.34);
    }
    parts.push(part(snow.build(), '#FFFFFF', { opacity: 0.95 }));
  }

  const dots = pb();
  for (let i = 0; i < (season === 'spring' ? 18 : season === 'winter' ? 4 : 9); i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * crownR * 0.95;
    dots.addCircle(Math.cos(a) * d, cy + Math.sin(a) * d * 0.75, crownR * (0.07 + rand() * 0.06));
  }
  parts.push(part(dots.build(), s.accent, { opacity: 0.9 }));
  return parts;
}

function pine(s: Species, u: number, season: Season): PlantPart[] {
  const h = u * s.size;
  const parts: PlantPart[] = [];
  const tw = u * 0.09;
  parts.push(part(Skia.Path.Rect({ x: -tw, y: -h * 0.25, width: tw * 2, height: h * 0.25 }), s.stem));
  const tiers = s.detail;
  const dark = pb();
  const light = pb();
  for (let i = 0; i < tiers; i++) {
    const base = -h * 0.16 - (i * h * 0.78) / tiers;
    const top = base - (h * 0.92) / tiers - h * 0.08;
    const half = u * 0.42 * (1 - i * 0.22);
    dark.moveTo(-half, base).lineTo(0, top).lineTo(half, base).close();
    if (season === 'winter') {
      // A cap of snow on every tier.
      const mid = base + (top - base) * 0.45;
      light.moveTo(-half * 0.55, mid).lineTo(0, top).lineTo(half * 0.55, mid).quadTo(0, mid + h * 0.05, -half * 0.55, mid).close();
    } else {
      light.moveTo(-half * 0.1, base).lineTo(0, top).lineTo(half, base).close();
    }
  }
  parts.push(part(dark.build(), s.primary));
  parts.push(part(light.build(), season === 'winter' ? '#FFFFFF' : s.accent, { opacity: season === 'winter' ? 0.95 : 0.55 }));
  return parts;
}

function cactus(s: Species, u: number): PlantPart[] {
  const h = u * s.size;
  const parts: PlantPart[] = [];
  const bw = u * 0.2;
  const arms = pb()
    .moveTo(0, -h * 0.35)
    .lineTo(-u * 0.36, -h * 0.35)
    .lineTo(-u * 0.36, -h * 0.66)
    .moveTo(0, -h * 0.5)
    .lineTo(u * 0.34, -h * 0.5)
    .lineTo(u * 0.34, -h * 0.8)
    .build();
  parts.push(part(arms, s.stem, { stroke: u * 0.17 }));
  const body = Skia.Path.RRect({ rect: { x: -bw, y: -h, width: bw * 2, height: h }, rx: bw, ry: bw });
  parts.push(part(body, s.primary));
  const ribs = pb()
    .moveTo(-bw * 0.35, -h * 0.9)
    .lineTo(-bw * 0.35, -h * 0.08)
    .moveTo(bw * 0.35, -h * 0.9)
    .lineTo(bw * 0.35, -h * 0.08)
    .build();
  parts.push(part(ribs, lighten(s.primary, 0.25), { stroke: Math.max(1, u * 0.03), opacity: 0.8 }));
  const bloom = pb();
  for (let i = 0; i < 5; i++) addLeaf(bloom, 0, -h, (-90 + (i - 2) * 36) * DEG, u * 0.2, u * 0.08);
  parts.push(part(bloom.build(), s.accent));
  return parts;
}

function mushroom(s: Species, u: number): PlantPart[] {
  const h = u * s.size;
  const parts: PlantPart[] = [];
  const sw = h * 0.16;
  const capW = h * 0.55;
  const capH = h * 0.5;
  const capY = -h * 0.55;
  const stalk = pb()
    .moveTo(-sw * 1.2, 0)
    .quadTo(-sw * 0.7, capY * 0.5, -sw * 0.8, capY)
    .lineTo(sw * 0.8, capY)
    .quadTo(sw * 0.7, capY * 0.5, sw * 1.2, 0)
    .close()
    .build();
  parts.push(part(stalk, s.stem));
  const cap = pb()
    .moveTo(-capW, capY)
    .cubicTo(-capW, capY - capH * 1.25, capW, capY - capH * 1.25, capW, capY)
    .quadTo(0, capY + capH * 0.22, -capW, capY)
    .close()
    .build();
  parts.push(part(cap, s.primary));
  if (s.detail > 0) {
    const spots = pb();
    const rand = mulberry32(hashString(s.id));
    for (let i = 0; i < s.detail; i++) {
      const fx = (i + 0.5) / s.detail - 0.5;
      spots.addCircle(fx * capW * 1.5, capY - capH * (0.35 + rand() * 0.4) * (1 - Math.abs(fx)), capW * (0.08 + rand() * 0.05));
    }
    parts.push(part(spots.build(), s.accent, { opacity: 0.95 }));
  } else {
    const shine = pb();
    addLeaf(shine, -capW * 0.5, capY - capH * 0.55, -20 * DEG, capW * 0.5, capH * 0.12);
    parts.push(part(shine.build(), lighten(s.primary, 0.4), { opacity: 0.7 }));
  }
  return parts;
}

function crystal(s: Species, u: number): PlantPart[] {
  const h = u * s.size;
  const parts: PlantPart[] = [];
  parts.push(part(circle(0, -h * 0.5, h * 0.75), s.primary, { blur: h * 0.3, opacity: 0.55 }));
  const shards: [number, number, number][] = [
    [-0.34, 0.55, -18],
    [0.36, 0.62, 16],
    [-0.16, 0.8, -7],
    [0.18, 0.72, 9],
    [0, 1, 0],
  ];
  shards.slice(0, s.detail).forEach(([ox, hf, tilt], i) => {
    const sh = h * hf;
    const w = u * 0.16;
    const a = tilt * DEG;
    const bx = ox * u;
    const ux = Math.sin(a);
    const uy = -Math.cos(a);
    const rx = Math.cos(a);
    const ry = Math.sin(a);
    const pt = (along: number, side: number): [number, number] => [bx + ux * along + rx * side, uy * along + ry * side];
    const [ax, ay] = pt(0, -w);
    const [bx2, by2] = pt(sh * 0.78, -w);
    const [tx, ty] = pt(sh, 0);
    const [cx, cy] = pt(sh * 0.78, w);
    const [dx, dy] = pt(0, w);
    const [mx, my] = pt(0, 0);
    const [nx, ny] = pt(sh * 0.78, 0);
    const left = pb().moveTo(ax, ay).lineTo(bx2, by2).lineTo(tx, ty).lineTo(nx, ny).lineTo(mx, my).close().build();
    const right = pb().moveTo(mx, my).lineTo(nx, ny).lineTo(tx, ty).lineTo(cx, cy).lineTo(dx, dy).close().build();
    parts.push(part(left, i % 2 ? lighten(s.primary, 0.3) : s.primary));
    parts.push(part(right, darken(s.stem, i % 2 ? 0 : 0.12)));
  });
  return parts;
}

const AUTUMN = ['#E8842C', '#D9542B', '#E3B23C'];

/** The colours a species wears in a season. Legendary plants and crystals do not care about the weather. */
function inSeason(s: Species, season: Season): Species {
  if (season === 'summer' || s.glow || s.kind === 'crystal' || s.kind === 'cactus' || s.kind === 'mushroom') return s;
  if (s.kind === 'tree') {
    if (season === 'autumn') return { ...s, primary: mixHex(s.primary, AUTUMN[hashString(s.id) % 3], 0.7), accent: '#FFD166' };
    if (season === 'winter') return { ...s, primary: mixHex(s.primary, '#DCE6EA', 0.55), accent: '#FFFFFF' };
    return { ...s, primary: lighten(s.primary, 0.08), accent: mixHex(s.accent, '#FFE3EE', 0.6) };
  }
  if (s.kind === 'pine') return s;
  // Flowers and ferns: straw-coloured in autumn, frosted in winter, a touch brighter in spring.
  if (season === 'autumn') return { ...s, stem: mixHex(s.stem, '#B59A3A', 0.35), primary: s.kind === 'fern' ? mixHex(s.primary, '#C9A227', 0.4) : s.primary };
  if (season === 'winter') return { ...s, stem: mixHex(s.stem, '#C9D6D2', 0.4), primary: mixHex(s.primary, '#E6EEF2', 0.3), accent: mixHex(s.accent, '#E6EEF2', 0.25) };
  return { ...s, primary: lighten(s.primary, 0.05) };
}

const BUILDERS: Record<Species['kind'], (s: Species, u: number, season: Season) => PlantPart[]> = {
  flower,
  fern,
  tree,
  pine,
  cactus,
  mushroom,
  crystal,
};

/**
 * The small, local detail that gives a variant away. Everything is drawn on
 * top of the unchanged plant and stays close to the trunk, the base or a
 * single leaf: nothing here changes the silhouette or the colours.
 */
function variantTell(variant: string, s: Species, u: number): PlantPart[] {
  const h = u * s.size;
  const stroke = (w: number) => Math.max(1, w);
  // Where the trunk (or stem, or stalk) is, and how wide.
  const trunkH = s.kind === 'tree' ? h * 0.5 : s.kind === 'pine' ? h * 0.25 : s.kind === 'mushroom' ? h * 0.55 : h;
  const trunkW = s.kind === 'tree' ? u * 0.1 : s.kind === 'pine' ? u * 0.09 : s.kind === 'cactus' ? u * 0.2 : s.kind === 'mushroom' ? h * 0.13 : u * 0.035;
  const crownR = h * 0.3;
  const crownY = -h * 0.5 - crownR * 0.75;
  const out: PlantPart[] = [];
  const raw = (path: SkPath, color: string, extra: Partial<PlantPart> = {}) => out.push({ path, color, wiltColor: wilted(color), ...extra });

  switch (variant) {
    case 'mossy': {
      const b = pb();
      b.addOval({ x: -trunkW - u * 0.2, y: -u * 0.055, width: u * 0.24, height: u * 0.09 });
      b.addOval({ x: -trunkW - u * 0.08, y: -u * 0.085, width: u * 0.13, height: u * 0.08 });
      raw(b.build(), '#5B9A4C');
      raw(pb().addOval({ x: -trunkW - u * 0.15, y: -u * 0.06, width: u * 0.1, height: u * 0.035 }).build(), '#86BF6C', { opacity: 0.9 });
      break;
    }
    case 'dew': {
      const drops = pb();
      const glints = pb();
      for (const [x, y] of [[-0.15, 0.2], [0.13, 0.27], [0.03, 0.12]] as const) {
        drops.addCircle(x * u, -y * h - u * 0.02, u * 0.026);
        glints.addCircle(x * u - u * 0.008, -y * h - u * 0.03, u * 0.009);
      }
      raw(drops.build(), '#CFEBFA', { opacity: 0.92 });
      raw(glints.build(), '#FFFFFF');
      break;
    }
    case 'lichen': {
      const b = pb();
      [0.14, 0.27, 0.38, 0.52].forEach((f, i) => {
        const x = (i % 2 ? 1 : -1) * trunkW * 0.38;
        b.addOval({ x: x - u * 0.024, y: -trunkH * f - u * 0.016, width: u * 0.048, height: u * 0.032 });
      });
      raw(b.build(), '#B4C6A2', { opacity: 0.95 });
      break;
    }
    case 'ivy': {
      const top = trunkH * 0.36;
      const vine = pb().moveTo(-trunkW * 0.9, 0);
      const leaves = pb();
      for (let i = 1; i <= 3; i++) {
        const y = -(top * i) / 3;
        const side = i % 2 ? 1 : -1;
        vine.quadTo(side * trunkW * 1.1, y + top / 6, side * trunkW * 0.55, y);
        addLeaf(leaves, side * trunkW * 0.55, y, (side > 0 ? -25 : -155) * DEG, u * 0.085, u * 0.034);
      }
      raw(vine.build(), '#2F6B3A', { stroke: stroke(u * 0.02) });
      raw(leaves.build(), '#27603A');
      break;
    }
    case 'knothole': {
      const y = -trunkH * 0.55;
      raw(pb().addOval({ x: -u * 0.045, y: y - u * 0.06, width: u * 0.09, height: u * 0.12 }).build(), lighten(s.stem, 0.22));
      raw(pb().addOval({ x: -u * 0.03, y: y - u * 0.045, width: u * 0.06, height: u * 0.09 }).build(), '#2E1D12');
      break;
    }
    case 'bracket': {
      const tops = pb();
      const unders = pb();
      [0.32, 0.54].forEach((f, i) => {
        const x = trunkW * (0.75 - i * 0.12);
        const y = -trunkH * f;
        const w = u * (0.085 - i * 0.015);
        tops.moveTo(x - w * 0.2, y).cubicTo(x, y - w * 0.55, x + w, y - w * 0.4, x + w, y).close();
        unders.moveTo(x - w * 0.2, y).lineTo(x + w, y).quadTo(x + w * 0.4, y + w * 0.28, x - w * 0.2, y).close();
      });
      raw(tops.build(), '#EAD9B8');
      raw(unders.build(), '#B89B72');
      break;
    }
    case 'twin': {
      const x = trunkW + u * 0.1;
      const top = -h * 0.42;
      raw(pb().moveTo(trunkW * 0.5, 0).quadTo(x + u * 0.06, top * 0.45, x, top).build(), s.stem, { stroke: stroke(u * (s.kind === 'cactus' ? 0.1 : s.kind === 'mushroom' ? 0.07 : 0.045)) });
      if (s.kind === 'mushroom') {
        raw(pb().moveTo(x - u * 0.09, top).cubicTo(x - u * 0.09, top - u * 0.11, x + u * 0.09, top - u * 0.11, x + u * 0.09, top).close().build(), s.primary);
      } else if (s.kind !== 'cactus') {
        const bud = pb();
        if (s.kind === 'fern') {
          addLeaf(bud, x, top + u * 0.04, -70 * DEG, u * 0.16, u * 0.05);
          addLeaf(bud, x, top + u * 0.04, -125 * DEG, u * 0.14, u * 0.045);
        } else {
          addLeaf(bud, x, top + u * 0.02, -90 * DEG, u * 0.13, u * 0.05);
        }
        raw(bud.build(), s.primary);
      }
      break;
    }
    case 'nesting': {
      const y = -trunkH - u * 0.01;
      const x = trunkW * 0.3;
      const eggs = pb();
      eggs.addOval({ x: x - u * 0.045, y: y - u * 0.075, width: u * 0.04, height: u * 0.052 });
      eggs.addOval({ x: x + u * 0.005, y: y - u * 0.07, width: u * 0.04, height: u * 0.052 });
      raw(eggs.build(), '#BFE3F0');
      raw(pb().moveTo(x - u * 0.09, y - u * 0.035).quadTo(x, y + u * 0.05, x + u * 0.09, y - u * 0.035).quadTo(x, y - u * 0.005, x - u * 0.09, y - u * 0.035).close().build(), '#8A6A45');
      raw(
        pb().moveTo(x - u * 0.1, y - u * 0.03).lineTo(x - u * 0.03, y + u * 0.005).moveTo(x + u * 0.11, y - u * 0.04).lineTo(x + u * 0.03, y).moveTo(x - u * 0.04, y + u * 0.012).lineTo(x + u * 0.06, y + u * 0.012).build(),
        '#6B4F33',
        { stroke: stroke(u * 0.012) },
      );
      break;
    }
    case 'lightning': {
      raw(
        pb()
          .moveTo(-trunkW * 0.2, -trunkH * 0.97)
          .lineTo(-trunkW * 0.5, -trunkH * 0.7)
          .lineTo(-trunkW * 0.15, -trunkH * 0.55)
          .lineTo(-trunkW * 0.55, -trunkH * 0.3)
          .lineTo(-trunkW * 0.35, -trunkH * 0.08)
          .build(),
        '#EBDDC3',
        { stroke: stroke(u * 0.022) },
      );
      const bx = s.kind === 'tree' ? crownR * 0.55 : u * 0.1;
      const by = s.kind === 'tree' ? crownY - crownR * 0.62 : -h * 0.9;
      raw(
        pb().moveTo(bx, by).lineTo(bx + u * 0.1, by - u * 0.13).lineTo(bx + u * 0.19, by - u * 0.15).moveTo(bx + u * 0.1, by - u * 0.13).lineTo(bx + u * 0.1, by - u * 0.24).build(),
        '#5A4636',
        { stroke: stroke(u * 0.02) },
      );
      break;
    }
    case 'sport': {
      if (s.kind === 'tree') {
        // One small cluster at the lower edge of the crown.
        const b = pb();
        const cx = crownR * 0.62;
        const cy = crownY + crownR * 0.42;
        b.addCircle(cx, cy, crownR * 0.13).addCircle(cx + crownR * 0.15, cy - crownR * 0.08, crownR * 0.11).addCircle(cx + crownR * 0.03, cy - crownR * 0.16, crownR * 0.1);
        raw(b.build(), '#F1ECC9');
        raw(pb().addCircle(cx + crownR * 0.03, cy - crownR * 0.05, crownR * 0.075).addCircle(cx + crownR * 0.14, cy - crownR * 0.09, crownR * 0.05).build(), mixHex(s.primary, '#F1ECC9', 0.35));
      } else {
        // One leaf (or frond) with a cream margin.
        const flowerLeaf = s.kind === 'flower';
        const x0 = 0;
        const y0 = flowerLeaf ? -h * 0.3 : 0;
        const a = (flowerLeaf ? -35 : -90 + 0.5 * 130 * (s.detail > 2 ? 0.6 : 0)) * DEG;
        const len = flowerLeaf ? u * 0.36 : h * 0.72;
        const w = flowerLeaf ? u * 0.13 : u * 0.16;
        const edge = pb();
        addLeaf(edge, x0, y0, a, len, w);
        raw(edge.build(), '#F3EBC8');
        const core = pb();
        addLeaf(core, x0 + Math.cos(a) * len * 0.08, y0 + Math.sin(a) * len * 0.08, a, len * 0.8, w * 0.5);
        raw(core.build(), flowerLeaf ? lighten(s.stem, 0.12) : s.primary);
      }
      break;
    }
  }
  return out;
}

const cache = new Map<string, PlantSpriteData>();

/** Build (and cache) the sprite of a species at a given unit size. */
export function plantSprite(speciesId: string, unit: number, season: Season = 'summer', variant: string | null = null): PlantSpriteData {
  const u = Math.round(unit * 2) / 2;
  const key = `${speciesId}@${u}:${season}:${variant ?? ''}`;
  let data = cache.get(key);
  if (!data) {
    const s = getSpecies(speciesId);
    const wide = s.kind === 'tree' ? 0.36 * s.size : s.kind === 'pine' ? 0.42 : 0.4;
    const tell = variant ? variantTell(variant, s, u) : [];
    data = { parts: [...BUILDERS[s.kind](inSeason(s, season), u, season), ...tell], height: u * s.size * 1.15, halfWidth: u * wide };
    cache.set(key, data);
  }
  return data;
}
