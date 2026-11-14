import type { Rarity } from '../game/types';

export const colors = {
  ink: '#1F3D2B',
  inkSoft: '#4B6455',
  inkFaint: '#8AA093',
  paper: '#FBF6EC',
  card: '#FFFFFF',
  cardEdge: '#EADFCB',
  leaf: '#3FAE6A',
  leafDark: '#2A8A52',
  leafLight: '#8FDB9B',
  soil: '#8A5A3C',
  soilDark: '#6B442C',
  coin: '#F2B84B',
  coinDark: '#C98A1B',
  danger: '#E26D5A',
  flame: '#FF8A3D',
  ice: '#6CC5F0',
  white: '#FFFFFF',
  shade: 'rgba(15, 30, 22, 0.55)',
};

export const rarityColor: Record<Rarity, string> = {
  common: '#6FBF73',
  rare: '#4DA3FF',
  epic: '#B06CFF',
  legendary: '#FFB636',
};

export const rarityTint: Record<Rarity, string> = {
  common: '#E8F6E9',
  rare: '#E3F0FF',
  epic: '#F1E6FF',
  legendary: '#FFF3D6',
};

export const fonts = {
  regular: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  heavy: 'Nunito_800ExtraBold',
  black: 'Nunito_900Black',
};

export const radius = { sm: 10, md: 16, lg: 24, pill: 999 };

export interface SkyPalette {
  top: string;
  mid: string;
  bottom: string;
  sun: string;
  cloud: string;
  /** Whether text placed on the sky should be light. */
  dark: boolean;
}

const SKIES: Record<'dawn' | 'day' | 'golden' | 'dusk' | 'night', SkyPalette> = {
  dawn: { top: '#9EC9F0', mid: '#F9D9C0', bottom: '#FCEBD3', sun: '#FFD9A0', cloud: '#FFFFFF', dark: false },
  day: { top: '#8FD0F5', mid: '#C8ECF8', bottom: '#F3F8E4', sun: '#FFF2B8', cloud: '#FFFFFF', dark: false },
  golden: { top: '#8DB6E6', mid: '#FAD59A', bottom: '#FDE8BC', sun: '#FFCB6B', cloud: '#FFF3DF', dark: false },
  dusk: { top: '#7C8FD9', mid: '#F2A99A', bottom: '#FCD9A8', sun: '#FFB870', cloud: '#FFE9DD', dark: false },
  night: { top: '#14213D', mid: '#243B63', bottom: '#3D5A80', sun: '#F4F1DE', cloud: '#8FA6C9', dark: true },
};

/** The sky at these hours; in between, the colours blend. */
const SKY_KEYS: [number, SkyPalette][] = [
  [0, SKIES.night],
  [4.6, SKIES.night],
  [6.2, SKIES.dawn],
  [8.5, SKIES.day],
  [15.5, SKIES.day],
  [17.5, SKIES.golden],
  [19.2, SKIES.dusk],
  [20.6, SKIES.night],
  [24, SKIES.night],
];

/** What an overcast sky does to the colours. */
const WEATHER_WASH: Record<string, [string, number]> = {
  rain: ['#8FA3B3', 0.5],
  snow: ['#D5DFE6', 0.45],
  haze: ['#CFC8AE', 0.4],
  fog: ['#BFC3BF', 0.62],
};

/** The sky for a local hour (fractions welcome) and the weather. */
export function skyAt(hour: number, weather = 'clear'): SkyPalette {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < SKY_KEYS.length - 2 && h >= SKY_KEYS[i + 1][0]) i++;
  const [h0, a] = SKY_KEYS[i];
  const [h1, b] = SKY_KEYS[i + 1];
  const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0);
  const mix = (k: 'top' | 'mid' | 'bottom' | 'sun' | 'cloud') => mixHex(a[k], b[k], t);
  let sky: SkyPalette = { top: mix('top'), mid: mix('mid'), bottom: mix('bottom'), sun: mix('sun'), cloud: mix('cloud'), dark: h < 5.4 || h >= 20 };
  const wash = WEATHER_WASH[weather];
  if (wash) {
    const [grey, amount] = wash;
    const dim = sky.dark ? darken(grey, 0.6) : grey;
    sky = {
      ...sky,
      top: mixHex(sky.top, dim, amount),
      mid: mixHex(sky.mid, dim, amount * 0.9),
      bottom: mixHex(sky.bottom, dim, amount * 0.7),
      cloud: mixHex(sky.cloud, sky.dark ? '#5C6B80' : '#C3CCD3', amount),
    };
  }
  return sky;
}

/** The sky follows the local time of day. */
export function skyForHour(hour: number): SkyPalette {
  return skyAt(hour);
}

/** Springs and timings shared by the whole app, so everything moves alike. */
export const motion = {
  press: { damping: 14, stiffness: 420, mass: 0.6 },
  pop: { damping: 7, stiffness: 190, mass: 0.7 },
  settle: { damping: 12, stiffness: 160, mass: 0.9 },
  wobble: { damping: 4, stiffness: 240, mass: 0.6 },
};

// --- colour helpers (plain JS, used when building sprites) -------------------

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function lighten(hex: string, t: number): string {
  return mixHex(hex, '#FFFFFF', t);
}

export function darken(hex: string, t: number): string {
  return mixHex(hex, '#000000', t);
}

/** What a colour looks like on a wilted plant: drained and slightly straw-coloured. */
export function wilted(hex: string): string {
  const [r, g, b] = parseHex(hex);
  const grey = 0.3 * r + 0.59 * g + 0.11 * b;
  const drained = toHex(r + (grey - r) * 0.8, g + (grey - g) * 0.8, b + (grey - b) * 0.8);
  return mixHex(drained, '#A89B78', 0.35);
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
