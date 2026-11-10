import type { Rarity } from './types';

export type PlantKind = 'flower' | 'fern' | 'tree' | 'pine' | 'cactus' | 'mushroom' | 'crystal';

export interface Species {
  id: string;
  name: string;
  rarity: Rarity;
  kind: PlantKind;
  /** One line shown on the reveal card. */
  blurb: string;
  /** Main colour (petals, canopy, cap or crystal). */
  primary: string;
  /** Second colour (flower centre, blossoms, spots, highlights). */
  accent: string;
  /** Stem / leaf / trunk colour. */
  stem: string;
  /** Relative height, 1 = a regular flower. */
  size: number;
  /** Kind-specific variation (petal count, canopy lobes, tiers, ...). */
  detail: number;
  /** Legendary plants glow softly. */
  glow?: boolean;
}

export const SPECIES: readonly Species[] = [
  // Common
  { id: 'clover', name: 'Clover', rarity: 'common', kind: 'fern', blurb: 'Small, stubborn and always first to come back.', primary: '#5DBB63', accent: '#8EDB7F', stem: '#3F8F4F', size: 0.7, detail: 5 },
  { id: 'daisy', name: 'Daisy', rarity: 'common', kind: 'flower', blurb: 'A little sun for an ordinary day.', primary: '#FFFFFF', accent: '#FFC93C', stem: '#4E9F5B', size: 0.9, detail: 9 },
  { id: 'tulip', name: 'Tulip', rarity: 'common', kind: 'flower', blurb: 'Stands tall after every focused hour.', primary: '#FF6B6B', accent: '#FFD166', stem: '#4E9F5B', size: 1.0, detail: 5 },
  { id: 'fern', name: 'Fern', rarity: 'common', kind: 'fern', blurb: 'Unfurls slowly, like a good idea.', primary: '#3FA66B', accent: '#7BD389', stem: '#2E7D51', size: 1.0, detail: 7 },
  { id: 'button-mushroom', name: 'Button Mushroom', rarity: 'common', kind: 'mushroom', blurb: 'Quietly appears while you are busy.', primary: '#E8D5B7', accent: '#C9A97C', stem: '#F6EBD8', size: 0.7, detail: 0 },
  // Rare
  { id: 'sunflower', name: 'Sunflower', rarity: 'rare', kind: 'flower', blurb: 'Turns its head to follow your streak.', primary: '#FFC121', accent: '#7A4A1E', stem: '#4C9A52', size: 1.45, detail: 14 },
  { id: 'lavender', name: 'Lavender', rarity: 'rare', kind: 'fern', blurb: 'Smells like a calm afternoon.', primary: '#9B7EDE', accent: '#C5B3F5', stem: '#5C9E6B', size: 1.15, detail: 6 },
  { id: 'pine', name: 'Young Pine', rarity: 'rare', kind: 'pine', blurb: 'Evergreen, even on slow days.', primary: '#2F8F5B', accent: '#57B97D', stem: '#7A5230', size: 1.6, detail: 3 },
  { id: 'cactus', name: 'Cactus', rarity: 'rare', kind: 'cactus', blurb: 'Forgives a missed day better than most.', primary: '#4FB286', accent: '#FF8FA3', stem: '#3A8F6B', size: 1.2, detail: 2 },
  // Epic
  { id: 'cherry', name: 'Cherry Blossom', rarity: 'epic', kind: 'tree', blurb: 'Blooms once the work is done.', primary: '#FFB7C5', accent: '#FFFFFF', stem: '#7A4B3A', size: 1.9, detail: 3 },
  { id: 'maple', name: 'Ember Maple', rarity: 'epic', kind: 'tree', blurb: 'Carries a whole autumn in its crown.', primary: '#F0803C', accent: '#FFD166', stem: '#6B4226', size: 2.0, detail: 4 },
  { id: 'fly-agaric', name: 'Fairy Cap', rarity: 'epic', kind: 'mushroom', blurb: 'Rumoured to grow only for the patient.', primary: '#E5383B', accent: '#FFFFFF', stem: '#FFF3E0', size: 1.25, detail: 5 },
  // Legendary
  { id: 'moonbloom', name: 'Moonbloom', rarity: 'legendary', kind: 'flower', blurb: 'Opens only for those who stayed.', primary: '#BDE0FE', accent: '#FFF7AE', stem: '#5E8FB5', size: 1.6, detail: 8, glow: true },
  { id: 'crystal', name: 'Heartstone', rarity: 'legendary', kind: 'crystal', blurb: 'Deep focus, grown solid.', primary: '#7DF9E0', accent: '#FFFFFF', stem: '#4AC6C0', size: 1.5, detail: 5, glow: true },
  { id: 'golden-oak', name: 'Golden Oak', rarity: 'legendary', kind: 'tree', blurb: 'Every leaf is an hour you kept.', primary: '#FFC93C', accent: '#FFF3B0', stem: '#7A5230', size: 2.2, detail: 5, glow: true },
];

const BY_ID: Record<string, Species> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

export function getSpecies(id: string): Species {
  return BY_ID[id] ?? SPECIES[0];
}

export function speciesOfRarity(rarity: Rarity): Species[] {
  return SPECIES.filter((s) => s.rarity === rarity);
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};
