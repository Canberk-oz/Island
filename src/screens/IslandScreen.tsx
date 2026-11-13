import { Canvas } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '../feel/haptics';
import { playAnimal, playSound, setAmbience, stopAmbience } from '../feel/sound';
import { CONFIG } from '../game/config';
import { hoursUntilFading, minutesToFullVitality, moodOf, vitalityNow, type VitalityMood } from '../game/decay';
import { TERRAIN_INFO, getAnimal, levelProgress, residents } from '../game/nature';
import { hashString } from '../game/rng';
import { BOND_LABELS, bondLevel, residentContext, stumps, threats, unseenNews, waterLevel, witherMarks } from '../game/stakes';
import { formatTime, newsText, newsTone, threatLevel, threatText } from '../ui/stakesText';
import { RARITY_LABEL, getSpecies } from '../game/species';
import { RARITIES, TERRAIN_KINDS, type Seed, type TerrainKind } from '../game/types';
import { formatMinutes } from '../game/time';
import { parseTile, plantsUntilExpansion, tileKey, tilesInRadius, unplantedSeeds } from '../game/world';
import { Burst } from '../render/Burst';
import { Island, layoutIsland, screenToTile, tileToScreen } from '../render/Island';
import { PlantIcon, PlantSheet, type SheetItem } from '../render/PlantSprite';
import { NO_POKE, type Poke } from '../render/Wildlife';
import { useClockMs } from '../render/clock';
import { Sky } from '../render/scene';
import { buildWildlife, fishTileAt, hitWildlife } from '../render/wildlife';
import { useStore } from '../store/store';
import { Button, CoinIcon, PressableScale, Txt } from '../ui/kit';
import { colors, motion, radius, rarityColor, rarityTint, skyForHour } from '../ui/theme';
import { SeedReveal } from './SeedReveal';

const MOOD: Record<VitalityMood, { label: string; color: string }> = {
  thriving: { label: 'Thriving', color: colors.leaf },
  thirsty: { label: 'Getting thirsty', color: '#C9A227' },
  wilting: { label: 'Wilting', color: '#C2783A' },
  dormant: { label: 'Resting', color: '#9A8F7A' },
};

const SLOT = 66;

interface SeedGroup {
  speciesId: string;
  seeds: Seed[];
}

/** What the next tap on a free tile will put there. */
type Pick = { type: 'seed'; id: string } | { type: 'nature'; kind: TerrainKind } | null;

function groupSeeds(seeds: Seed[]): SeedGroup[] {
  const map = new Map<string, Seed[]>();
  for (const s of seeds) map.set(s.speciesId, [...(map.get(s.speciesId) ?? []), s]);
  return [...map.entries()]
    .map(([speciesId, list]) => ({ speciesId, seeds: list }))
    .sort(
      (a, b) =>
        RARITIES.indexOf(b.seeds[0].rarity) - RARITIES.indexOf(a.seeds[0].rarity) ||
        getSpecies(a.speciesId).name.localeCompare(getSpecies(b.speciesId).name),
    );
}

export function grantText(grants: Partial<Record<TerrainKind, number>>): string {
  const parts = TERRAIN_KINDS.filter((k) => grants[k]).map((k) => `${grants[k]} ${TERRAIN_INFO[k].name.toLowerCase()}`);
  return parts.join(', ');
}

export function IslandScreen({
  preselectSeedId,
  onShare,
}: {
  preselectSeedId: string | null;
  onShare: () => void;
}) {
  const { width: w, height: h } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const game = useStore((s) => s.game);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const plant = useStore((s) => s.plant);
  const dig = useStore((s) => s.dig);
  const placeNature = useStore((s) => s.placeNature);
  const liftNature = useStore((s) => s.liftNature);
  const discover = useStore((s) => s.discover);
  const pouch = useStore((s) => s.pouch);
  const notify = useStore((s) => s.notify);
  const updateSettings = useStore((s) => s.updateSettings);
  const setImmersive = useStore((s) => s.setImmersive);
  const revive = useStore((s) => s.revive);
  const refresh = useStore((s) => s.refresh);
  const markNewsSeen = useStore((s) => s.markNewsSeen);

  // Whatever happened while the island was not on screen is settled before it is drawn.
  useEffect(() => {
    refresh();
  }, [refresh, settings.timeOffsetMs]);

  const clock = useClockMs(true);
  const palette = useMemo(() => skyForHour(new Date(now()).getHours()), [now, settings.timeOffsetMs]);
  const night = palette.dark;
  const world = game.world;
  const stock = game.nature.stock;
  const waiting = useMemo(() => unplantedSeeds(game), [game]);
  const groups = useMemo(() => groupSeeds(waiting), [waiting]);
  const natureKinds = useMemo(() => TERRAIN_KINDS.filter((k) => stock[k] > 0), [stock]);

  const firstPick = (): Pick => {
    if (preselectSeedId) return { type: 'seed', id: preselectSeedId };
    if (waiting[0]) return { type: 'seed', id: waiting[0].id };
    if (natureKinds[0]) return { type: 'nature', kind: natureKinds[0] };
    return null;
  };
  const [pick, setPick] = useState<Pick>(firstPick);
  const [tile, setTile] = useState<string | null>(null);
  const [popped, setPopped] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null);
  const [bubble, setBubble] = useState<{ id: number; text: string; x: number; y: number } | null>(null);
  const [pouchSeed, setPouchSeed] = useState<{ seed: Seed; isNew: boolean } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const serial = useRef(0);

  // Keep the selection valid as things get placed.
  useEffect(() => {
    const valid =
      pick == null
        ? false
        : pick.type === 'seed'
          ? !!game.seeds[pick.id] && game.seeds[pick.id].tile == null
          : stock[pick.kind] > 0;
    if (valid) return;
    if (pick?.type === 'nature' && natureKinds[0]) setPick({ type: 'nature', kind: natureKinds[0] });
    else if (waiting[0]) setPick({ type: 'seed', id: waiting[0].id });
    else if (natureKinds[0]) setPick({ type: 'nature', kind: natureKinds[0] });
    else if (pick != null) setPick(null);
  }, [game.seeds, natureKinds, pick, stock, waiting]);

  const layout = useMemo(() => layoutIsland(world.radius, w / 2, h * 0.45, w, h * 0.5), [world.radius, w, h]);

  // The island fades or revives in front of the player: animate from the
  // vitality that was last on screen to the current one.
  const target = vitalityNow(world, now());
  const vitality = useSharedValue(settings.lastSeenVitality);
  const lastTarget = useRef<number | null>(null);
  useEffect(() => {
    const from = lastTarget.current ?? settings.lastSeenVitality;
    if (lastTarget.current !== null && Math.abs(from - target) < 0.001) return;
    const delta = target - from;
    lastTarget.current = target;
    vitality.value = withDelay(
      450,
      withTiming(target, { duration: delta < 0 ? 3000 : 1900, easing: Easing.inOut(Easing.cubic) }),
    );
    if (Object.keys(world.tiles).length > 0) {
      if (delta < -0.08) later(600, () => haptic('soft'));
      else if (delta > 0.08)
        later(600, () => {
          haptic('success');
          playSound('grow', 0.6);
        });
    }
    updateSettings({ lastSeenVitality: target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // --- wildlife ------------------------------------------------------------
  // Everyone whose habitat exists gets a track; whether they are out or hiding
  // follows the displayed vitality, so they fade away as the island wilts.
  const nature = game.nature;
  const water = waterLevel(game, now());
  const waterShown = Math.round(water * 20) / 20;
  const habitat = useMemo(
    // Animals whose water has dried up stay out of sight until it is back.
    () => residents(world, game.seeds, 1, { ...residentContext(game, now()), water: waterShown }).filter((r) => !r.dry),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world, game.seeds, nature.away, nature.family, waterShown],
  );
  const ruined = useMemo(
    () => Object.entries(nature.landmarks).filter(([, m]) => m?.ruined).map(([k]) => k),
    [nature.landmarks],
  );
  // Each session that withered in the last day leaves a twig on a free tile.
  const marks = useMemo(() => {
    const free = tilesInRadius(world.radius).filter((t) => !world.tiles[t.key] && !world.terrain[t.key]);
    const out: Record<string, number> = {};
    for (const m of witherMarks(game, now())) {
      const open = free.filter((t) => !(t.key in out));
      if (open.length === 0) break;
      out[open[hashString(m.id) % open.length].key] = m.at;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.sessions, world.radius, world.tiles, world.terrain]);
  const markKeys = useMemo(() => Object.keys(marks), [marks]);
  const scene = useMemo(() => buildWildlife(layout, world, game.seeds, habitat, night), [layout, world, game.seeds, habitat, night]);
  const out = useMemo(
    () => habitat.filter((r) => target >= (getAnimal(r.id)?.shy ?? 1) && (night || !getAnimal(r.id)?.nocturnal)),
    [habitat, target, night],
  );
  const hiding = habitat.length - habitat.filter((r) => target >= (getAnimal(r.id)?.shy ?? 1)).length;
  const poke = useSharedValue<Poke>(NO_POKE);

  const showBanner = useCallback((text: string) => {
    const id = ++serial.current;
    setBanner({ id, text });
    setTimeout(() => setBanner((b) => (b?.id === id ? null : b)), 3200);
  }, []);

  // Welcome animals that moved in for the first time.
  useEffect(() => {
    const id = setTimeout(() => {
      const arrived = discover(night);
      if (arrived.length > 2) {
        // A whole crowd at once (a big island seen for the first time): one welcome for all.
        haptic('success');
        playSound('arrive');
        showBanner(`${arrived.length} kinds of animals moved in!`);
        const first = getAnimal(arrived[0]);
        if (first) later(700, () => playAnimal(first.sound));
        return;
      }
      arrived.forEach((animalId, i) => {
        const def = getAnimal(animalId);
        if (!def) return;
        later(i * 3400, () => {
          haptic('success');
          playSound('arrive');
          showBanner(`${def.name} moved in!`);
        });
        later(i * 3400 + 700, () => playAnimal(def.sound));
      });
    }, 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.tiles, world.terrain, target, night]);

  // --- soundscape ----------------------------------------------------------
  const waterCount = useMemo(() => Object.values(world.terrain).filter((k) => k === 'water').length, [world.terrain]);
  const liveliness = Math.round(target * 10) / 10;
  const applyAmbience = useCallback(() => {
    // A wilted island is a quiet island.
    const life = Math.max(0.12, liveliness);
    setAmbience({
      [night ? 'night' : 'day']: 0.55 * life,
      water: waterCount > 0 ? Math.min(0.5, 0.18 + 0.06 * waterCount) * Math.max(0.3, liveliness) : 0,
    });
  }, [liveliness, night, waterCount]);
  useEffect(() => {
    if (AppState.currentState === 'active') applyAmbience();
    const sub = AppState.addEventListener('change', (state) => (state === 'active' ? applyAmbience() : stopAmbience()));
    return () => sub.remove();
  }, [applyAmbience, settings.sound]);
  useEffect(() => stopAmbience, []);

  // Now and then one of the animals that is out calls.
  const outRef = useRef(out);
  outRef.current = out;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          const list = outRef.current;
          if (list.length > 0 && AppState.currentState === 'active') {
            const def = getAnimal(list[Math.floor(Math.random() * list.length)].id);
            if (def) playAnimal(def.sound, 0.3);
          }
          schedule();
        },
        6000 + Math.random() * 8000,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  // --- taps ----------------------------------------------------------------
  const islandScale = useSharedValue(1);
  const burst = useSharedValue(0);
  const [burstAt, setBurstAt] = useState({ x: w / 2, y: h / 2, n: 0, water: false });

  const celebrateGrowth = useCallback(() => {
    later(450, () => {
      haptic('success');
      playSound('grow');
      islandScale.value = withSequence(withTiming(0.86, { duration: 120, easing: Easing.out(Easing.quad) }), withSpring(1, motion.pop));
      showBanner('Your island grew!');
    });
  }, [islandScale, later, showBanner]);

  const onCanvasPress = useCallback(
    (e: GestureResponderEvent) => {
      // On web a press is a mouse event, which reports offsetX / offsetY instead.
      const ne = e.nativeEvent as typeof e.nativeEvent & { offsetX?: number; offsetY?: number };
      const px = ne.locationX ?? ne.offsetX ?? 0;
      const py = ne.locationY ?? ne.offsetY ?? 0;
      const t = clock.value;

      // Animals first: tapping one makes it jump and call.
      const animal = hitWildlife(scene, t / 1000, px, py, target, layout);
      if (animal) {
        const def = getAnimal(animal.id);
        poke.value = { key: animal.key, at: t, x: animal.x, y: animal.y };
        haptic('light');
        if (def) playAnimal(def.sound);
        const id = ++serial.current;
        const bond = nature.bonds[animal.id];
        const lvl = bondLevel(bond?.points ?? 0);
        const young = animal.key.endsWith(':young');
        const who = young ? `${bond?.name ? `${bond.name}'s` : 'A'} little one` : bond?.name ?? def?.name ?? '';
        setBubble({ id, text: lvl > 0 && !young ? `${who}\n${BOND_LABELS[lvl]} ${'💛'.repeat(lvl)}` : who, x: animal.x, y: animal.y });
        setTimeout(() => setBubble((b) => (b?.id === id ? null : b)), 1500);
        return;
      }

      const hit = screenToTile(layout, px, py, world.radius);
      if (!hit) {
        setTile(null);
        return;
      }
      const key = tileKey(hit.x, hit.y);
      const { sx, sy } = tileToScreen(layout, hit.x, hit.y);

      if (world.tiles[key] || world.terrain[key]) {
        haptic('tick');
        if (world.terrain[key] === 'water' && fishTileAt(scene, sx, sy + layout.th * 0.12, target, layout)) {
          // The fish answer a tap on their lake.
          poke.value = { key: 'fish', at: t, x: sx, y: sy + layout.th * 0.12 };
          playAnimal('splash');
        } else {
          playSound('tap', 0.6);
        }
        setTile(tile === key ? null : key);
        return;
      }

      setTile(null);
      if (marks[key] != null && !pick) {
        // The twig of a session that withered: it says when. (With something
        // in hand, planting over it is the better answer.)
        haptic('soft');
        playSound('crack', 0.4);
        const id = ++serial.current;
        setBubble({ id, text: `A session withered here\nat ${formatTime(marks[key])}`, x: sx, y: sy });
        setTimeout(() => setBubble((b) => (b?.id === id ? null : b)), 2400);
        return;
      }
      if (!pick) {
        haptic('soft');
        notify('info', 'Finish a focus session to earn a seed.');
        return;
      }
      const res = pick.type === 'seed' ? plant(pick.id, hit.x, hit.y) : placeNature(pick.kind, hit.x, hit.y);
      if (!res.ok) return;
      const isWater = pick.type === 'nature' && pick.kind === 'water';
      setPopped(key);
      setBurstAt((b) => ({ x: sx, y: sy, n: b.n + 1, water: isWater }));
      burst.value = 0;
      burst.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) });
      haptic('medium');
      playSound(pick.type === 'seed' ? 'plant' : isWater ? 'place_water' : 'place_stone');
      if (res.islandGrew) celebrateGrowth();
    },
    [burst, celebrateGrowth, clock, layout, marks, nature.bonds, notify, pick, placeNature, plant, poke, scene, target, tile, world.radius, world.terrain, world.tiles],
  );

  const buyPouch = () => {
    const res = pouch();
    if (!res) {
      haptic('warning');
      notify('info', `A lucky pouch costs ${CONFIG.economy.pouchCost} coins.`);
      return;
    }
    playSound('coin');
    setImmersive(true);
    setPouchSeed({ seed: res.seed, isNew: res.isNewSpecies });
  };
  const closePouch = (select: boolean) => {
    if (select && pouchSeed) setPick({ type: 'seed', id: pouchSeed.seed.id });
    setPouchSeed(null);
    setImmersive(false);
  };
  useEffect(() => () => setImmersive(false), [setImmersive]);

  // --- texts ---------------------------------------------------------------
  const mood = moodOf(target);
  const fadingIn = hoursUntilFading(world, now());
  const toFull = minutesToFullVitality(world, now());
  const planted = Object.keys(world.tiles).length;
  const dead = useMemo(() => stumps(game).length, [game]);
  const next = threats(game, now())[0];
  const fresh = useMemo(() => unseenNews(nature), [nature]);
  const [newsOpen, setNewsOpen] = useState(true);
  // Losses are worth interrupting for; good news already had its moment after the session.
  const showNews = newsOpen && fresh.some((n) => newsTone(n) === 'bad');
  useEffect(() => {
    // Good news alone needs no card: it counts as read once the island was looked at.
    if (fresh.length > 0 && !fresh.some((n) => newsTone(n) === 'bad')) markNewsSeen();
  }, [fresh, markNewsSeen]);
  useEffect(() => {
    if (!showNews) return;
    haptic('warning');
    playSound('wither', 0.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNews]);
  // One line per loss; a crowd of departures is told as one.
  const lossRows = useMemo(() => {
    const bad = fresh.filter((n) => newsTone(n) === 'bad');
    const left = bad.filter((n) => n.kind === 'left');
    const rest = bad.filter((n) => n.kind !== 'left').map(newsText);
    if (left.length <= 3) return [...left.map(newsText), ...rest];
    const names = left.slice(0, 3).map((n) => n.name ?? getAnimal(n.subject)?.name.toLowerCase() ?? n.subject);
    return [`${left.length} animals moved away: ${names.join(', ')} and ${left.length - 3} more`, ...rest];
  }, [fresh]);
  const moodDetail =
    world.graceUntil == null
      ? 'Finish a session to earn your first seed'
      : next && next.kind !== 'fade'
        ? threatText(next, now())
        : fadingIn > 0
        ? `Stays green for ${fadingIn >= 1 ? `${Math.floor(fadingIn)}h` : 'under an hour'} without focus`
        : hiding > 0
          ? `${hiding} ${hiding === 1 ? 'animal is' : 'animals are'} hiding · ${toFull} min of focus brings them back`
          : target >= 0.985
            ? 'Focus 10+ minutes today to keep it green'
            : `${toFull} min of focus brings it fully back`;
  const untilGrow = plantsUntilExpansion(world);
  const ink = palette.dark ? colors.white : colors.ink;
  const level = levelProgress(game.economy.lifetimeFocusMin);
  const animalCount = out.reduce((n, r) => n + r.count, 0);
  const subtitle = [
    planted === 0 ? 'Nothing planted yet' : `${planted - dead} ${planted - dead === 1 ? 'plant' : 'plants'}`,
    dead > 0 ? `${dead} dead` : null,
    animalCount > 0 ? `${animalCount} ${animalCount === 1 ? 'animal' : 'animals'}` : null,
    untilGrow > 0 && planted > 0 ? `${untilGrow} more to grow` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const tileSeed = tile && world.tiles[tile] ? game.seeds[world.tiles[tile]] : null;
  const tileNature = tile ? world.terrain[tile] : undefined;
  const tileDead = !!tileSeed && tileSeed.diedAt != null;
  const pickedSeed = pick?.type === 'seed' ? game.seeds[pick.id] : null;
  const pickedKind = pick?.type === 'nature' ? pick.kind : null;

  const sheetItems: SheetItem[] = [
    ...natureKinds.map((k, i) => ({ terrain: k, cx: i * SLOT + 29, top: 6, size: 46 })),
    ...groups.map((g, i) => ({ speciesId: g.speciesId, cx: (natureKinds.length + i) * SLOT + 29, top: 6, size: 46 })),
  ];

  return (
    <View style={StyleSheet.absoluteFill} testID="island-screen">
      <Canvas style={StyleSheet.absoluteFill}>
        <Sky w={w} h={h} palette={palette} clock={clock} />
        <Island
          layout={layout}
          world={world}
          seeds={game.seeds}
          scene={scene}
          poke={poke}
          vitality={vitality}
          clock={clock}
          waterLevel={waterShown}
          ruined={ruined}
          marks={markKeys}
          showFreeTiles={!!pick && !tile}
          selectedTile={tile}
          poppedTile={popped}
          scale={islandScale}
        />
        <Burst
          key={burstAt.n}
          t={burst}
          x={burstAt.x}
          y={burstAt.y}
          colors={burstAt.water ? ['#FFFFFF', '#8FD9FF', '#56BDEE'] : ['#FFFFFF', colors.leafLight, colors.coin]}
          count={22}
          reach={70}
          gravity={50}
          size={5}
          seed={burstAt.n + 2}
          upward
        />
      </Canvas>

      <Pressable style={StyleSheet.absoluteFill} onPress={onCanvasPress} testID="island-touch" accessibilityLabel="Island" />

      {bubble && (
        <Animated.View
          key={bubble.id}
          entering={FadeInDown.springify().damping(11)}
          exiting={FadeOut.duration(250)}
          pointerEvents="none"
          style={[styles.bubble, { left: Math.min(w - 150, Math.max(10, bubble.x - 70)), top: bubble.y - 78 }]}
          testID="animal-bubble"
        >
          <Txt weight="black" size={14} center>
            {bubble.text}
          </Txt>
        </Animated.View>
      )}

      <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <View style={styles.headerRow} pointerEvents="box-none">
          <View style={{ flex: 1 }} pointerEvents="none">
            <Txt weight="black" size={26} color={ink}>
              Your island
            </Txt>
            <Txt weight="heavy" size={13} color={ink} style={{ opacity: 0.75 }} testID="island-subtitle">
              {subtitle}
            </Txt>
          </View>
          <PressableScale onPress={onShare} style={styles.shareBtn} testID="share-button" accessibilityLabel="Share a picture of your island">
            <Txt weight="heavy" size={14}>
              Share
            </Txt>
          </PressableScale>
        </View>

        <View style={styles.vitality} pointerEvents="none" testID="vitality-card">
          <View style={styles.vitalityTop}>
            <View style={[styles.moodDot, { backgroundColor: MOOD[mood].color }]} />
            <Txt weight="black" size={15} testID="mood-label">
              {MOOD[mood].label}
            </Txt>
            <Txt weight="heavy" size={13} color={colors.inkFaint} style={{ marginLeft: 'auto' }}>
              {`${Math.round(target * 100)}%`}
            </Txt>
          </View>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.max(3, target * 100)}%`, backgroundColor: MOOD[mood].color }]} />
          </View>
          <Txt
            weight="bold"
            size={12.5}
            color={next && next.kind !== 'fade' && threatLevel(next, now()) === 'urgent' ? '#C2381A' : colors.inkSoft}
            style={{ marginTop: 6 }}
            testID="mood-detail"
          >
            {moodDetail}
          </Txt>
          <View style={styles.levelRow}>
            <View style={styles.levelChip}>
              <Txt weight="black" size={12} color={colors.white} testID="island-level">
                {`Level ${level.level}`}
              </Txt>
            </View>
            <View style={styles.levelBar}>
              <View style={[styles.levelFill, { width: `${Math.max(4, Math.min(1, level.fraction) * 100)}%` }]} />
            </View>
            <Txt weight="bold" size={11.5} color={colors.inkSoft} numberOfLines={1} style={{ flexShrink: 1 }}>
              {`${formatMinutes(level.minutesToNext)} of focus to ${grantText(level.nextGrants)}`}
            </Txt>
          </View>
        </View>

        {banner && (
          <Animated.View
            key={banner.id}
            entering={FadeInDown.springify().damping(10)}
            exiting={FadeOut.duration(400)}
            style={styles.banner}
            pointerEvents="none"
            testID="island-banner"
          >
            <Txt weight="black" size={16} color={colors.white} center>
              {banner.text}
            </Txt>
          </Animated.View>
        )}
      </View>

      <View style={[styles.tray, { bottom: insets.bottom + 92 }]}>
        {tileSeed || tileNature ? (
          <Animated.View entering={FadeIn.duration(180)} style={styles.trayCard} testID="tile-card">
            <View style={[styles.iconWell, { backgroundColor: tileSeed ? rarityTint[tileSeed.rarity] : '#E3F2FB' }]}>
              {tileSeed ? <PlantIcon speciesId={tileSeed.speciesId} size={52} silhouette={tileDead} /> : <PlantIcon terrain={tileNature} size={52} />}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Txt weight="black" size={17}>
                {tileSeed ? getSpecies(tileSeed.speciesId).name : TERRAIN_INFO[tileNature!].name}
              </Txt>
              {tileDead ? (
                <Txt weight="bold" size={12} color="#A4512F" numberOfLines={2}>
                  Died in the drought
                </Txt>
              ) : tileSeed ? (
                <Txt weight="heavy" size={12.5} color={rarityColor[tileSeed.rarity]}>
                  {RARITY_LABEL[tileSeed.rarity]}
                </Txt>
              ) : (
                <Txt weight="bold" size={12} color={colors.inkSoft} numberOfLines={2}>
                  {TERRAIN_INFO[tileNature!].blurb}
                </Txt>
              )}
            </View>
            {tileDead && (
              <PressableScale
                onPress={() => {
                  const { x, y } = parseTile(tile!);
                  const res = revive(x, y);
                  if (!res.ok) {
                    haptic('warning');
                    notify('info', `Reviving it costs ${res.cost} coins.`);
                    return;
                  }
                  haptic('success');
                  playSound('grow');
                  setPopped(tile);
                  setTile(null);
                }}
                style={[styles.digBtn, { backgroundColor: colors.leaf, borderColor: colors.leaf, marginRight: 8, flexDirection: 'row' }]}
                testID="revive-plant"
                accessibilityLabel={`Revive for ${CONFIG.stakes.reviveCost[tileSeed!.rarity]} coins`}
              >
                <CoinIcon size={13} />
                <Txt weight="heavy" size={13} color={colors.white} style={{ marginLeft: 4 }}>
                  {CONFIG.stakes.reviveCost[tileSeed!.rarity]}
                </Txt>
              </PressableScale>
            )}
            <PressableScale
              onPress={() => {
                const { x, y } = parseTile(tile!);
                if (tileDead) {
                  // Clearing a stump frees the tile; the plant is gone.
                  dig(x, y);
                } else if (tileSeed) {
                  dig(x, y);
                  setPick({ type: 'seed', id: tileSeed.id });
                } else {
                  liftNature(x, y);
                  setPick({ type: 'nature', kind: tileNature! });
                }
                setTile(null);
                playSound('drop');
              }}
              style={styles.digBtn}
              testID="dig-up"
            >
              <Txt weight="heavy" size={13}>
                {tileDead ? 'Clear' : 'Move'}
              </Txt>
            </PressableScale>
          </Animated.View>
        ) : (
          <View style={styles.trayCard}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trayScroll}>
              <PressableScale onPress={buyPouch} style={styles.pouch} testID="buy-pouch" accessibilityLabel="Buy a lucky pouch">
                <Txt size={22}>🎁</Txt>
                <View style={styles.pouchPrice}>
                  <CoinIcon size={11} />
                  <Txt weight="black" size={11.5} style={{ marginLeft: 3 }}>
                    {CONFIG.economy.pouchCost}
                  </Txt>
                </View>
              </PressableScale>
              {natureKinds.map((k) => {
                const on = pickedKind === k;
                return (
                  <PressableScale
                    key={k}
                    feel="tick"
                    onPress={() => {
                      setTile(null);
                      setPick({ type: 'nature', kind: k });
                    }}
                    testID={`nature-${k}`}
                    accessibilityLabel={`${TERRAIN_INFO[k].name}, ${stock[k]} to place`}
                    style={[styles.seedSlot, { backgroundColor: '#E3F2FB', borderColor: on ? '#3FA9E0' : 'transparent' }]}
                  >
                    <View style={[styles.count, { backgroundColor: '#3FA9E0' }]}>
                      <Txt weight="black" size={11} color={colors.white}>
                        {stock[k]}
                      </Txt>
                    </View>
                  </PressableScale>
                );
              })}
              {groups.map((g) => {
                const on = pickedSeed?.speciesId === g.speciesId;
                const rarity = g.seeds[0].rarity;
                return (
                  <PressableScale
                    key={g.speciesId}
                    feel="tick"
                    onPress={() => {
                      setTile(null);
                      setPick({ type: 'seed', id: g.seeds[0].id });
                    }}
                    testID={`seed-${g.speciesId}`}
                    accessibilityLabel={`${getSpecies(g.speciesId).name}, ${g.seeds.length} seeds`}
                    style={[styles.seedSlot, { backgroundColor: rarityTint[rarity], borderColor: on ? rarityColor[rarity] : 'transparent' }]}
                  >
                    {g.seeds.length > 1 && (
                      <View style={[styles.count, { backgroundColor: rarityColor[rarity] }]}>
                        <Txt weight="black" size={11} color={colors.white}>
                          {g.seeds.length}
                        </Txt>
                      </View>
                    )}
                  </PressableScale>
                );
              })}
              {sheetItems.length === 0 ? (
                <View style={styles.trayEmpty}>
                  <Txt weight="heavy" size={13.5} color={colors.inkSoft}>
                    Nothing to place right now
                  </Txt>
                  <Txt weight="bold" size={12} color={colors.inkFaint}>
                    Every finished session drops a seed
                  </Txt>
                </View>
              ) : (
                <PlantSheet width={sheetItems.length * SLOT} height={58} items={sheetItems} style={{ position: 'absolute', left: SLOT, top: 10 }} />
              )}
            </ScrollView>
          </View>
        )}
        <Txt weight="heavy" size={12.5} color={ink} center style={{ marginTop: 6, opacity: 0.8 }} testID="tray-hint">
          {tileDead
            ? 'Your next session revives one plant, or pay coins now'
            : tileSeed || tileNature
            ? 'Move puts it back in your tray'
            : pickedSeed
              ? `Tap a free tile to plant your ${getSpecies(pickedSeed.speciesId).name}`
              : pickedKind
                ? `Tap a free tile to place ${TERRAIN_INFO[pickedKind].name.toLowerCase()}`
                : out.length > 0
                  ? 'Tap an animal to say hello'
                  : 'Tap a plant to see what it is'}
        </Txt>
      </View>

      {showNews && (
        <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(200)} style={styles.newsShade} testID="news-card">
          <Animated.View entering={FadeInDown.springify().damping(13)} style={styles.newsCard}>
            <Txt weight="black" size={21} center>
              While you were away
            </Txt>
            <View style={{ marginTop: 10 }}>
              {lossRows.map((text, i) => (
                <View key={i} style={styles.newsRow}>
                  <View style={[styles.moodDot, { backgroundColor: '#C2531A' }]} />
                  <Txt weight="heavy" size={14.5} style={{ flex: 1 }}>
                    {text}
                  </Txt>
                </View>
              ))}
            </View>
            <Txt weight="bold" size={13} color={colors.inkSoft} center style={{ marginTop: 10 }}>
              {`Nothing is lost for good. Every session of ${CONFIG.streak.minQualifyingMin}+ minutes revives a plant, and ${CONFIG.stakes.revivalDays} days of focus bring half of them back at once.`}
            </Txt>
            <Button
              label="I'll bring them back"
              onPress={() => {
                setNewsOpen(false);
                markNewsSeen();
              }}
              style={{ marginTop: 14 }}
              testID="news-ok"
            />
          </Animated.View>
        </Animated.View>
      )}

      {pouchSeed && (
        <SeedReveal seed={pouchSeed.seed} isNew={pouchSeed.isNew} from={{ x: w / 2, y: -40 }}>
          <Button label="Plant it" onPress={() => closePouch(true)} testID="pouch-plant" />
        </SeedReveal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 18 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  shareBtn: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vitality: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  vitalityTop: { flexDirection: 'row', alignItems: 'center' },
  moodDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(31,61,43,0.1)', marginTop: 8, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  levelRow: { flexDirection: 'row', alignItems: 'center', marginTop: 9 },
  levelChip: { backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  levelBar: { width: 54, height: 6, borderRadius: 3, backgroundColor: 'rgba(31,61,43,0.12)', marginHorizontal: 8, overflow: 'hidden' },
  levelFill: { height: 6, borderRadius: 3, backgroundColor: colors.coin },
  banner: {
    alignSelf: 'center',
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.leaf,
  },
  newsShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(20,35,28,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  newsCard: { alignSelf: 'stretch', backgroundColor: colors.card, borderRadius: radius.lg, padding: 20 },
  newsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  bubble: {
    position: 'absolute',
    width: 140,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  tray: { position: 'absolute', left: 14, right: 14 },
  trayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 78,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.lg,
    paddingHorizontal: 10,
  },
  trayScroll: { alignItems: 'center', paddingVertical: 10, paddingRight: 6 },
  trayEmpty: { justifyContent: 'center', paddingHorizontal: 10 },
  pouch: {
    width: 58,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: '#FFF3D6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  pouchPrice: { flexDirection: 'row', alignItems: 'center', marginTop: -2 },
  seedSlot: {
    width: 58,
    height: 58,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    borderWidth: 3,
  },
  count: {
    position: 'absolute',
    right: -5,
    top: -5,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWell: { width: 58, height: 58, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  digBtn: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.cardEdge,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
