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

const SKIES: Record<'dawn' | 'day' | 'dusk' | 'night', SkyPalette> = {
  dawn: { top: '#9EC9F0', mid: '#F9D9C0', bottom: '#FCEBD3', sun: '#FFD9A0', cloud: '#FFFFFF', dark: false },
  day: { top: '#8FD0F5', mid: '#C8ECF8', bottom: '#F3F8E4', sun: '#FFF2B8', cloud: '#FFFFFF', dark: false },
  dusk: { top: '#7C8FD9', mid: '#F2A99A', bottom: '#FCD9A8', sun: '#FFC27A', cloud: '#FFE9DD', dark: false },
  night: { top: '#14213D', mid: '#243B63', bottom: '#3D5A80', sun: '#F4F1DE', cloud: '#8FA6C9', dark: true },
};

/** The sky follows the local time of day. */
export function skyForHour(hour: number): SkyPalette {
  if (hour >= 5 && hour < 8) return SKIES.dawn;
  if (hour >= 8 && hour < 17) return SKIES.day;
  if (hour >= 17 && hour < 20) return SKIES.dusk;
  return SKIES.night;
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
