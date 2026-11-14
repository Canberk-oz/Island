import { clamp } from './rng';
import type { PlantKind } from './species';
import type { Rand } from './types';

/**
 * Variants: rare quirks a plant can be born with. They are things that
 * really happen to plants, and each shows as one small, local detail (a mark
 * on the bark, a nest in a fork, a single odd leaf). The plant itself looks
 * exactly as it always does: from a distance you cannot tell, up close you can.
 */

export type VariantTier = 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface VariantDef {
  id: string;
  name: string;
  tier: VariantTier;
  /** Chance per seed at a 25 minute session, for the plants it can occur on. */
  chance: number;
  kinds: readonly PlantKind[];
  /** What to look for. */
  tell: string;
  /** One line of natural history. */
  lore: string;
}

const WOODY: PlantKind[] = ['tree', 'pine'];
const SOFT: PlantKind[] = ['flower', 'fern'];

/** Rarest first: a seed takes the rarest variant it rolls. */
export const VARIANTS: readonly VariantDef[] = [
  {
    id: 'lightning',
    name: 'Lightning-scarred',
    tier: 'legendary',
    chance: 0.002,
    kinds: WOODY,
    tell: 'A thin pale scar runs down one side of the trunk, and one bare forked twig sticks out of the crown.',
    lore: 'It was struck once and kept growing around the wound.',
  },
  {
    id: 'nesting',
    name: 'Nesting',
    tier: 'epic',
    chance: 0.006,
    kinds: WOODY,
    tell: 'A small twig nest with two pale blue eggs sits where the trunk meets the crown.',
    lore: 'Somebody decided this was the safest tree on the island.',
  },
  {
    id: 'sport',
    name: 'Variegated sport',
    tier: 'epic',
    chance: 0.006,
    kinds: [...SOFT, 'tree'],
    tell: 'A single leaf (on a tree, one small cluster) is edged in cream instead of green.',
    lore: 'One bud mutated. Gardeners call it a sport and take cuttings.',
  },
  {
    id: 'knothole',
    name: 'Knotholed',
    tier: 'rare',
    chance: 0.015,
    kinds: ['tree'],
    tell: 'A small dark hollow with a raised rim sits halfway up the trunk.',
    lore: 'A branch fell long ago and the tree healed around the gap.',
  },
  {
    id: 'ivy',
    name: 'Ivy-clasped',
    tier: 'rare',
    chance: 0.02,
    kinds: WOODY,
    tell: 'A thin ivy vine with three small dark leaves winds up the lowest third of the trunk.',
    lore: 'The ivy does the tree no harm. It only wants the light.',
  },
  {
    id: 'bracket',
    name: 'Bracket-bearing',
    tier: 'rare',
    chance: 0.012,
    kinds: WOODY,
    tell: 'Two little cream shelf fungi step up one side of the trunk.',
    lore: 'Bracket fungi move in on old wood and stay for decades.',
  },
  {
    id: 'twin',
    name: 'Twin-stemmed',
    tier: 'rare',
    chance: 0.02,
    kinds: [...SOFT, 'cactus', 'mushroom'],
    tell: 'A second, much smaller shoot rises from the base beside the main one.',
    lore: 'Two from one root: the seed split before it sprouted.',
  },
  {
    id: 'lichen',
    name: 'Lichen-flecked',
    tier: 'uncommon',
    chance: 0.04,
    kinds: [...WOODY, 'cactus'],
    tell: 'A few pale grey-green flecks dot the lower trunk.',
    lore: 'Lichen only grows where the air is clean.',
  },
  {
    id: 'dew',
    name: 'Dew-holding',
    tier: 'uncommon',
    chance: 0.04,
    kinds: [...SOFT, 'mushroom'],
    tell: 'Three beads of dew sit low on the plant and never quite dry.',
    lore: 'Fine hairs on the leaves hold on to the morning.',
  },
  {
    id: 'mossy',
    name: 'Moss-footed',
    tier: 'uncommon',
    chance: 0.05,
    kinds: ['tree', 'pine', 'cactus', 'mushroom', 'flower', 'fern', 'crystal'],
    tell: 'A cushion of moss hugs the foot of the plant on its shaded side.',
    lore: 'Moss marks the damp side. Foresters read it like a compass.',
  },
];

const BY_ID: Record<string, VariantDef> = Object.fromEntries(VARIANTS.map((v) => [v.id, v]));

export function getVariant(id: string | null | undefined): VariantDef | undefined {
  return id ? BY_ID[id] : undefined;
}

export const TIER_LABEL: Record<VariantTier, string> = { uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

/** A variant plant holds out this much longer in a drought. */
export const TIER_HARDY_HOURS: Record<VariantTier, number> = { uncommon: 12, rare: 24, epic: 48, legendary: 96 };

export function variantHardyHours(id: string | null | undefined): number {
  const v = getVariant(id);
  return v ? TIER_HARDY_HOURS[v.tier] : 0;
}

/** Chance that a seed of this kind of plant has any variant at all. */
export function variantChance(kind: PlantKind, minutes: number): number {
  const luck = clamp(minutes / 25, 0.8, 2);
  return Math.min(1, VARIANTS.filter((v) => v.kinds.includes(kind)).reduce((sum, v) => sum + v.chance * luck, 0));
}

/** Roll the variant of a new seed (usually none). Longer sessions are a little luckier. */
export function rollVariant(kind: PlantKind, minutes: number, rand: Rand): string | null {
  const luck = clamp(minutes / 25, 0.8, 2);
  let r = rand();
  for (const v of VARIANTS) {
    if (!v.kinds.includes(kind)) continue;
    const p = v.chance * luck;
    if (r < p) return v.id;
    r -= p;
  }
  return null;
}
