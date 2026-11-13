import { CONFIG, HOUR_MS } from './config';
import { vitalityNow } from './decay';
import { getAnimal, residents, type AnimalDef, type Resident, type ResidentContext } from './nature';
import { clamp01, hash01 } from './rng';
import { streakAtRisk } from './streak';
import { dayIndex, dayStartAt } from './time';
import { LANDMARK_KINDS, RARITIES } from './types';
import type { GameState, LandmarkKind, Nature, NewsItem, Rand, Rarity, Seed, World } from './types';

/**
 * What neglect costs, and how it is won back.
 *
 * Like vitality, nothing here runs in the background. One number carries the
 * damage: the drought meter, the hours the island has spent completely wilted
 * minus one hour for every focused minute. Animals move away and plants die
 * when the meter passes their limit. It is brought up to date ("settled")
 * whenever the app is opened and before every finished session, so a week of
 * absence is the same case as a minute.
 */

const S = CONFIG.stakes;

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** The moment vitality reaches `v` on its way down (Infinity when it never fades). */
export function timeAtVitality(world: World, v: number): number {
  if (world.graceUntil == null) return Infinity;
  // Already at or below: it has been so at least since it was measured.
  if (world.vitality <= v) return world.vitalityAt;
  const fadingFrom = Math.max(world.vitalityAt, world.graceUntil);
  return fadingFrom + (world.vitality - v) * CONFIG.decay.hoursToEmpty * HOUR_MS;
}

/** The moment the island is completely wilted. */
export function zeroAt(world: World): number {
  return timeAtVitality(world, 0);
}

/** The drought meter at `now` (hours). */
export function droughtNow(state: GameState, now: number): number {
  const from = Math.max(state.nature.settledAt, zeroAt(state.world));
  return Math.min(S.maxDroughtHours, state.nature.drought + Math.max(0, now - from) / HOUR_MS);
}

/** The drought level at which something that came back counts its limit from (0 for everything else). */
function sparedAt(nature: Nature, key: string): number {
  return nature.spared[key] ?? 0;
}

/** The moment the drought meter reaches `hours` if nobody focuses (Infinity when it never will). */
function timeAtDrought(state: GameState, hours: number, now: number): number {
  const zero = zeroAt(state.world);
  if (zero === Infinity) return Infinity;
  const left = hours - droughtNow(state, now);
  return Math.max(now, zero) + Math.max(0, left) * HOUR_MS;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/** How full the ponds and lakes are, 0 (mud) .. 1. Sinks when the island wilts, dries up in a drought. */
export function waterLevelOf(vitality: number, drought: number): number {
  const low = 0.55 + 0.45 * clamp01(vitality / S.waterLowBelow);
  return clamp01(low * (1 - drought / S.waterDryHours));
}

export function waterLevel(state: GameState, now: number): number {
  return waterLevelOf(vitalityNow(state.world, now), droughtNow(state, now));
}

// ---------------------------------------------------------------------------
// Bonds and families
// ---------------------------------------------------------------------------

export const BOND_LABELS = ['Stranger', 'Familiar', 'Friend', 'Companion', 'Family'] as const;

export function bondLevel(points: number): number {
  let level = 0;
  for (let i = 0; i < S.bondLevels.length; i++) if (points >= S.bondLevels[i] - 1e-9) level = i;
  return level;
}

/** Days of focus until the next bond level (0 at the top). */
export function daysToNextBond(points: number): number {
  const level = bondLevel(points);
  if (level >= S.bondLevels.length - 1) return 0;
  return Math.max(1, Math.ceil(S.bondLevels[level + 1] - points - 1e-9));
}

const NAMES: Record<string, readonly string[]> = {
  bird: ['Pip', 'Wren', 'Skye', 'Robin', 'Piper', 'Lark'],
  frog: ['Bog', 'Lily', 'Hopper', 'Moss', 'Puddle', 'Ribbit'],
  rabbit: ['Clover', 'Hazel', 'Thumper', 'Biscuit', 'Cotton', 'Nibbles'],
  squirrel: ['Acorn', 'Chestnut', 'Nutmeg', 'Twig', 'Conker', 'Pecan'],
  duck: ['Puddles', 'Waddle', 'Dabble', 'Quill', 'Pond', 'Mallow'],
  hedgehog: ['Bramble', 'Thistle', 'Prickle', 'Conker', 'Burr', 'Truffle'],
  deer: ['Fern', 'Willow', 'Aspen', 'Juniper', 'Dapple', 'Birch'],
  fox: ['Rusty', 'Ember', 'Maple', 'Copper', 'Saffron', 'Russet'],
  owl: ['Luna', 'Sage', 'Hoot', 'Dusk', 'Athena', 'Echo'],
};

/** Animals that get a name once they are a friend (the ones you can tell apart). */
export function canBeNamed(id: string): boolean {
  return id in NAMES;
}

/** Animals that can have young. */
const BREEDERS: readonly string[] = ['rabbit', 'duck', 'squirrel', 'hedgehog', 'deer', 'fox'];

export function hasYoung(nature: Nature, id: string, now: number): boolean {
  const born = nature.family[id];
  return born != null && now - born < S.youngGrowsInDays * 24 * HOUR_MS;
}

/** "Rusty the fox" or "the fox". */
export function callName(id: string, name?: string | null): string {
  const def = getAnimal(id);
  const kind = (def?.name ?? id).toLowerCase();
  return name ? `${name} the ${kind}` : `the ${kind}`;
}

/** Who lives on the island right now, with everything the stakes add to the habitat rules. */
export function residentContext(state: GameState, now: number): ResidentContext {
  const ids = Object.keys(state.nature.family);
  return {
    away: state.nature.away,
    young: ids.filter((id) => hasYoung(state.nature, id, now)),
    grown: ids.filter((id) => !hasYoung(state.nature, id, now)),
    water: waterLevel(state, now),
  };
}

export function islandResidents(state: GameState, now: number, vitality = vitalityNow(state.world, now)): Resident[] {
  return residents(state.world, state.seeds, vitality, residentContext(state, now));
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Drought hours after which an animal moves away. */
export function leaveAfterHours(def: AnimalDef, bondPoints: number, young: boolean): number {
  const hardy = Math.max(0, 0.65 - def.shy) * 10;
  const hours = S.leaveAfterHours + hardy * S.leaveHoursPerHardiness + bondLevel(bondPoints) * S.leaveHoursPerBondLevel;
  // A family does not gamble on a wilted island.
  return young ? Math.min(hours, S.familyLeavesAfterHours) : hours;
}

/** Drought hours after which the plant on a tile dies. */
export function plantDiesAfterHours(tileKey: string, rarity: Rarity): number {
  return S.plantDiesAfterHours + hash01(`d${tileKey}`) * S.plantDeathSpreadHours + S.plantDeathExtraHours[rarity];
}

export function stumps(state: GameState): Seed[] {
  return Object.values(state.world.tiles)
    .map((id) => state.seeds[id])
    .filter((s): s is Seed => !!s && s.diedAt != null);
}

/** Stumps in the order they are revived: the rarest first, then the oldest loss. */
function revivalOrder(list: Seed[]): Seed[] {
  return [...list].sort(
    (a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || (a.diedAt ?? 0) - (b.diedAt ?? 0) || a.id.localeCompare(b.id),
  );
}

function reviveSeeds(seeds: Record<string, Seed>, list: Seed[]): Record<string, Seed> {
  if (list.length === 0) return seeds;
  const next = { ...seeds };
  for (const s of list) next[s.id] = { ...s, diedAt: null };
  return next;
}

function addNews(nature: Nature, items: NewsItem[]): Nature {
  if (items.length === 0) return nature;
  return { ...nature, news: [...nature.news, ...items].slice(-S.newsCap) };
}

// ---------------------------------------------------------------------------
// Settling: what the time away has cost
// ---------------------------------------------------------------------------

export interface Settlement {
  state: GameState;
  news: NewsItem[];
}

/**
 * Bring the island up to date with the clock: grow the drought meter, cool
 * the bonds of animals that had to hide, let animals move away and plants die.
 * Returns the same state when nothing happened.
 */
export function settleIsland(state: GameState, now: number): Settlement {
  const { world, nature } = state;
  const news: NewsItem[] = [];
  const drought = droughtNow(state, now);
  let changed = drought !== nature.drought;
  // Events are dated when they happened, but never before the diary was last read.
  const floor = Math.max(nature.settledAt, nature.newsSeenAt + 1);

  // Bonds cool while an animal hides.
  let bonds = nature.bonds;
  for (const [id, bond] of Object.entries(nature.bonds)) {
    const def = getAnimal(id);
    if (!def || bond.points <= 0 || nature.away[id]) continue;
    const hiddenFrom = Math.max(nature.settledAt, timeAtVitality(world, def.shy));
    const days = Math.max(0, now - hiddenFrom) / (24 * HOUR_MS);
    if (days <= 0) continue;
    if (bonds === nature.bonds) bonds = { ...bonds };
    bonds[id] = { ...bond, points: Math.max(0, bond.points - days * S.bondLossPerHiddenDay) };
    changed = true;
  }

  // Animals move away, the shyest first. Only ones the player has met can be missed.
  let away = nature.away;
  let family = nature.family;
  if (drought > nature.drought) {
    for (const r of residents(world, state.seeds, 1, { away })) {
      const def = getAnimal(r.id);
      if (!def || nature.discovered[r.id] == null) continue;
      const bond = bonds[r.id];
      const limit = sparedAt(nature, r.id) + leaveAfterHours(def, bond?.points ?? 0, hasYoung(nature, r.id, now));
      if (drought < limit) continue;
      const leftAt = Math.min(now, Math.max(floor, now - (drought - limit) * HOUR_MS));
      if (away === nature.away) away = { ...away };
      away[r.id] = { leftAt, days: 0 };
      if (bond) {
        if (bonds === nature.bonds) bonds = { ...bonds };
        bonds[r.id] = { ...bond, points: 0 };
      }
      if (family[r.id] != null) {
        if (family === nature.family) family = { ...family };
        delete family[r.id];
      }
      news.push({ at: leftAt, kind: 'left', subject: r.id, name: bond?.name ?? null });
    }
  }

  // Plants die and leave a stump.
  let seeds = state.seeds;
  if (drought > nature.drought) {
    const died: Seed[] = [];
    let firstAt = now;
    for (const [key, seedId] of Object.entries(world.tiles)) {
      const seed = state.seeds[seedId];
      if (!seed || seed.diedAt != null) continue;
      const limit = sparedAt(nature, seedId) + plantDiesAfterHours(key, seed.rarity);
      if (drought < limit) continue;
      const diedAt = Math.min(now, Math.max(floor, now - (drought - limit) * HOUR_MS));
      firstAt = Math.min(firstAt, diedAt);
      if (seeds === state.seeds) seeds = { ...seeds };
      seeds[seedId] = { ...seed, diedAt };
      died.push(seed);
    }
    if (died.length > 0) {
      const rarest = revivalOrder(died.map((s) => ({ ...s, diedAt: 0 })))[0];
      news.push({ at: firstAt, kind: 'died', subject: rarest.speciesId, count: died.length });
    }
  }

  // A comeback quest that ran out of days.
  let revival = nature.revival;
  if (revival && dayIndex(now) - revival.startDay >= S.revivalWindowDays) {
    revival = null;
    news.push({ at: now, kind: 'questFailed', subject: '' });
  }

  if (!changed && news.length === 0) return { state, news };
  news.sort((a, b) => a.at - b.at);
  return {
    state: {
      ...state,
      seeds,
      nature: addNews({ ...nature, drought, settledAt: now, bonds, away, family, revival }, news),
    },
    news,
  };
}

// ---------------------------------------------------------------------------
// Focus: what a finished session wins back
// ---------------------------------------------------------------------------

/**
 * Apply a finished session to the stakes. Call it after the world was fed and
 * the streak was counted. `firstOfDay` is true for the first session of 10+
 * minutes on a focus day: bonds, returns, births and the quest advance once a day.
 */
export function rewardFocus(
  state: GameState,
  minutes: number,
  qualifies: boolean,
  firstOfDay: boolean,
  now: number,
  rand: Rand,
): Settlement {
  const news: NewsItem[] = [];
  let nature: Nature = {
    ...state.nature,
    drought: Math.max(0, state.nature.drought - Math.max(0, minutes) * S.droughtPaidPerMinute),
    settledAt: now,
  };
  // With the drought paid off, everything is back on equal terms.
  if (nature.drought === 0 && Object.keys(nature.spared).length > 0) nature = { ...nature, spared: {} };
  let seeds = state.seeds;
  if (!qualifies) return { state: { ...state, nature }, news };
  const spared = { ...nature.spared };
  const spare = (key: string) => {
    if (nature.drought > 0) spared[key] = nature.drought;
  };

  // Every real session brings one stump back to life.
  const dead = revivalOrder(stumps(state));
  if (dead.length > 0) {
    seeds = reviveSeeds(seeds, [dead[0]]);
    spare(dead[0].id);
    news.push({ at: now, kind: 'revived', subject: dead[0].speciesId, count: 1 });
  }

  if (firstOfDay) {
    const today = dayIndex(now);
    const current = { ...state, seeds, nature };

    // Bonds grow with every animal that is out today.
    const bonds = { ...nature.bonds };
    for (const r of islandResidents(current, now)) {
      if (!r.present || nature.discovered[r.id] == null) continue;
      const before = bonds[r.id] ?? { points: 0, name: null };
      const points = Math.min(S.maxBond, before.points + 1);
      let name = before.name;
      if (bondLevel(points) >= 2 && bondLevel(before.points) < 2) {
        const pool = NAMES[r.id];
        if (pool && !name) name = pool[Math.floor(rand() * pool.length) % pool.length];
        news.push({ at: now, kind: 'befriended', subject: r.id, name });
      }
      bonds[r.id] = { points, name };
    }

    // Animals that moved away come closer with every day of focus.
    const away = { ...nature.away };
    for (const [id, a] of Object.entries(away)) {
      const days = a.days + 1;
      if (days >= S.returnDays) {
        delete away[id];
        spare(id);
        news.push({ at: now, kind: 'returned', subject: id, name: bonds[id]?.name ?? null });
      } else {
        away[id] = { ...a, days };
      }
    }
    nature = { ...nature, bonds, away };

    // The comeback quest.
    let revival = nature.revival;
    const lostAnimals = Object.keys(nature.away).sort((a, b) => nature.away[a].leftAt - nature.away[b].leftAt);
    const lostPlants = revivalOrder(stumps({ ...state, seeds }));
    if (revival) {
      revival = { ...revival, days: revival.days + 1 };
      if (revival.days >= S.revivalDays) {
        const back = lostAnimals.slice(0, Math.ceil(lostAnimals.length / 2));
        const regrown = lostPlants.slice(0, Math.ceil(lostPlants.length / 2));
        const stillAway = { ...nature.away };
        for (const s of regrown) spare(s.id);
        for (const id of back) {
          delete stillAway[id];
          spare(id);
          news.push({ at: now, kind: 'returned', subject: id, name: nature.bonds[id]?.name ?? null });
        }
        seeds = reviveSeeds(seeds, regrown);
        if (regrown.length > 0) news.push({ at: now, kind: 'revived', subject: regrown[0].speciesId, count: regrown.length });
        news.push({ at: now, kind: 'questDone', subject: '' });
        nature = { ...nature, away: stillAway };
        revival = null;
      }
    } else if (lostAnimals.length >= 1 || lostPlants.length >= 3) {
      revival = { startDay: today, days: 1 };
      news.push({ at: now, kind: 'questStarted', subject: '' });
    }
    nature = { ...nature, revival };

    // A long streak and a good friendship bring young.
    const sinceBirth = nature.lastBirthDay == null ? Infinity : today - nature.lastBirthDay;
    if (state.progress.streak >= S.youngAtStreak && sinceBirth >= S.daysBetweenBirths) {
      const parents = islandResidents({ ...state, seeds, nature }, now)
        .filter((r) => r.present && BREEDERS.includes(r.id) && nature.family[r.id] == null)
        .filter((r) => bondLevel(nature.bonds[r.id]?.points ?? 0) >= S.youngAtBondLevel)
        .sort((a, b) => (nature.bonds[b.id]?.points ?? 0) - (nature.bonds[a.id]?.points ?? 0) || a.id.localeCompare(b.id));
      if (parents[0]) {
        const id = parents[0].id;
        nature = { ...nature, family: { ...nature.family, [id]: now }, lastBirthDay: today };
        news.push({ at: now, kind: 'born', subject: id, name: nature.bonds[id]?.name ?? null });
      }
    }
  }

  return { state: { ...state, seeds, nature: addNews({ ...nature, spared }, news) }, news };
}

// ---------------------------------------------------------------------------
// Stumps
// ---------------------------------------------------------------------------

export type ReviveResult = { ok: true; state: GameState; cost: number } | { ok: false; reason: 'notDead' | 'notEnoughCoins'; cost: number };

/** Pay coins to bring the stump on a tile back to life right away. */
export function revivePlant(state: GameState, tileKey: string, now: number): ReviveResult {
  const seed = state.seeds[state.world.tiles[tileKey]];
  if (!seed || seed.diedAt == null) return { ok: false, reason: 'notDead', cost: 0 };
  const cost = S.reviveCost[seed.rarity];
  if (state.economy.coins < cost) return { ok: false, reason: 'notEnoughCoins', cost };
  return {
    ok: true,
    cost,
    state: {
      ...state,
      seeds: reviveSeeds(state.seeds, [seed]),
      economy: { ...state.economy, coins: state.economy.coins - cost },
      nature: addNews({ ...state.nature, spared: { ...state.nature.spared, [seed.id]: droughtNow(state, now) } }, [
        { at: now, kind: 'revived', subject: seed.speciesId, count: 1 },
      ]),
    },
  };
}

// ---------------------------------------------------------------------------
// Streak landmarks
// ---------------------------------------------------------------------------

export function landmarkRebuildStreak(kind: LandmarkKind): number {
  return Math.ceil(S.landmarkStreaks[kind] * S.landmarkRebuildFraction);
}

/**
 * Keep the landmarks in step with the streak: a lost streak leaves them in
 * ruins, a streak that is long enough builds or rebuilds them.
 */
export function syncLandmarks(state: GameState, streakLost: number, now: number): Settlement {
  const news: NewsItem[] = [];
  const landmarks = { ...state.nature.landmarks };
  const stock = { ...state.nature.stock };
  const streak = state.progress.streak;
  for (const kind of LANDMARK_KINDS) {
    const mark = landmarks[kind];
    if (mark && !mark.ruined && streakLost > 0) {
      landmarks[kind] = { ...mark, ruined: true };
      news.push({ at: now, kind: 'ruined', subject: kind });
    } else if (!mark && streak >= S.landmarkStreaks[kind]) {
      landmarks[kind] = { earnedAt: now, ruined: false };
      stock[kind] = (stock[kind] ?? 0) + 1;
      news.push({ at: now, kind: 'landmark', subject: kind });
    } else if (mark?.ruined && streak >= landmarkRebuildStreak(kind)) {
      landmarks[kind] = { ...mark, ruined: false };
      news.push({ at: now, kind: 'rebuilt', subject: kind });
    }
  }
  if (news.length === 0) return { state, news };
  return { state: { ...state, nature: addNews({ ...state.nature, landmarks, stock }, news) }, news };
}

// ---------------------------------------------------------------------------
// Marks of withered sessions
// ---------------------------------------------------------------------------

export interface WitherMark {
  id: string;
  at: number;
  reason: string;
}

/** Sessions that withered recently: each leaves a dead twig on the island for a day. */
export function witherMarks(state: GameState, now: number, max = 3): WitherMark[] {
  const since = now - S.scarHours * HOUR_MS;
  return state.sessions
    .filter((s) => s.outcome === 'withered' && s.endedAt > since && s.endedAt <= now)
    .slice(-max)
    .map((s) => ({ id: s.id, at: s.endedAt, reason: s.witherReason ?? 'left' }));
}

// ---------------------------------------------------------------------------
// What happens next if nobody focuses
// ---------------------------------------------------------------------------

export type ThreatKind = 'fade' | 'hide' | 'dry' | 'leave' | 'stump' | 'streak' | 'quest';

export interface Threat {
  kind: ThreatKind;
  at: number;
  /** For hide / leave. */
  animalId?: string;
  name?: string | null;
}

/** Everything that is about to go wrong, soonest first. Empty on an island with nothing to lose. */
export function threats(state: GameState, now: number): Threat[] {
  const { world, nature, progress } = state;
  const out: Threat[] = [];
  const add = (t: Threat) => {
    if (Number.isFinite(t.at) && t.at > now) out.push(t);
  };
  const livingPlants = Object.entries(world.tiles).filter(([, id]) => state.seeds[id] && state.seeds[id].diedAt == null);

  if (world.graceUntil != null && livingPlants.length + Object.keys(world.terrain).length > 0) {
    if (world.vitality > 0) add({ kind: 'fade', at: Math.max(world.graceUntil, world.vitalityAt) });

    const known = islandResidents(state, now).filter((r) => nature.discovered[r.id] != null);
    const earliest = (list: Threat[]) => list.sort((a, b) => a.at - b.at)[0];

    const hides = known
      .filter((r) => r.present)
      .map((r): Threat => ({ kind: 'hide', at: timeAtVitality(world, getAnimal(r.id)!.shy), animalId: r.id, name: nature.bonds[r.id]?.name }));
    if (hides.length) add(earliest(hides));

    const leaves = known.map((r): Threat => {
      const limit = sparedAt(nature, r.id) + leaveAfterHours(getAnimal(r.id)!, nature.bonds[r.id]?.points ?? 0, hasYoung(nature, r.id, now));
      return { kind: 'leave', at: timeAtDrought(state, limit, now), animalId: r.id, name: nature.bonds[r.id]?.name };
    });
    if (leaves.length) add(earliest(leaves));

    if (livingPlants.length > 0) {
      const first = Math.min(...livingPlants.map(([key, id]) => sparedAt(nature, id) + plantDiesAfterHours(key, state.seeds[id].rarity)));
      add({ kind: 'stump', at: timeAtDrought(state, first, now) });
    }

    if (Object.values(world.terrain).includes('water') && waterLevel(state, now) > 0) {
      add({ kind: 'dry', at: timeAtDrought(state, S.waterDryHours, now) });
    }
  }

  const today = dayIndex(now);
  if (streakAtRisk(progress, today) && progress.lastStreakDay === today - 1 && progress.freezes === 0) {
    add({ kind: 'streak', at: dayStartAt(today + 1, new Date(now).getTimezoneOffset()) });
  }
  if (nature.revival) {
    add({ kind: 'quest', at: dayStartAt(nature.revival.startDay + S.revivalWindowDays, new Date(now).getTimezoneOffset()) });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Diary entries the player has not seen yet. */
export function unseenNews(nature: Nature): NewsItem[] {
  return nature.news.filter((n) => n.at > nature.newsSeenAt);
}

/** True when the animal exists and its habitat is on the island, whether it is out or not. */
export function animalStatus(state: GameState, id: string, now: number): 'away' | 'out' | 'hiding' | 'absent' {
  if (state.nature.away[id]) return 'away';
  const r = islandResidents(state, now).find((x) => x.id === id);
  if (!r) return 'absent';
  return r.present ? 'out' : 'hiding';
}
