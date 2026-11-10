import { Canvas } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
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
import { playSound } from '../feel/sound';
import { CONFIG } from '../game/config';
import { hoursUntilFading, minutesToFullVitality, moodOf, vitalityNow, type VitalityMood } from '../game/decay';
import { RARITY_LABEL, getSpecies } from '../game/species';
import { RARITIES, type Seed } from '../game/types';
import { parseTile, plantsUntilExpansion, tileKey, unplantedSeeds } from '../game/world';
import { Burst } from '../render/Burst';
import { Island, layoutIsland, screenToTile, tileToScreen } from '../render/Island';
import { PlantIcon, PlantSheet } from '../render/PlantSprite';
import { useClockMs } from '../render/clock';
import { Sky } from '../render/scene';
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

interface SeedGroup {
  speciesId: string;
  seeds: Seed[];
}

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
  const pouch = useStore((s) => s.pouch);
  const notify = useStore((s) => s.notify);
  const updateSettings = useStore((s) => s.updateSettings);
  const setImmersive = useStore((s) => s.setImmersive);

  const clock = useClockMs(true);
  const palette = useMemo(() => skyForHour(new Date(now()).getHours()), [now, settings.timeOffsetMs]);
  const world = game.world;
  const waiting = useMemo(() => unplantedSeeds(game), [game]);
  const groups = useMemo(() => groupSeeds(waiting), [waiting]);

  const [seedId, setSeedId] = useState<string | null>(preselectSeedId ?? waiting[0]?.id ?? null);
  const [tile, setTile] = useState<string | null>(null);
  const [popped, setPopped] = useState<string | null>(null);
  const [grewBanner, setGrewBanner] = useState(false);
  const [pouchSeed, setPouchSeed] = useState<{ seed: Seed; isNew: boolean } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Keep the selection valid as seeds get planted.
  useEffect(() => {
    if (seedId && game.seeds[seedId]?.tile == null && game.seeds[seedId]) return;
    setSeedId(waiting[0]?.id ?? null);
  }, [game.seeds, seedId, waiting]);

  const layout = useMemo(
    () => layoutIsland(world.radius, w / 2, h * 0.43, w, h * 0.5),
    [world.radius, w, h],
  );

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
      if (delta < -0.08) {
        timers.current.push(setTimeout(() => haptic('soft'), 600));
      } else if (delta > 0.08) {
        timers.current.push(
          setTimeout(() => {
            haptic('success');
            playSound('grow', 0.6);
          }, 600),
        );
      }
    }
    updateSettings({ lastSeenVitality: target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const islandScale = useSharedValue(1);
  const burst = useSharedValue(0);
  const [burstAt, setBurstAt] = useState({ x: w / 2, y: h / 2, n: 0 });

  const onCanvasPress = useCallback(
    (e: GestureResponderEvent) => {
      // On web a press is a mouse event, which reports offsetX / offsetY instead.
      const ne = e.nativeEvent as typeof e.nativeEvent & { offsetX?: number; offsetY?: number };
      const locationX = ne.locationX ?? ne.offsetX ?? 0;
      const locationY = ne.locationY ?? ne.offsetY ?? 0;
      const hit = screenToTile(layout, locationX, locationY, world.radius);
      if (!hit) {
        setTile(null);
        return;
      }
      const key = tileKey(hit.x, hit.y);
      if (world.tiles[key]) {
        haptic('tick');
        playSound('tap', 0.6);
        setTile(tile === key ? null : key);
        return;
      }
      setTile(null);
      if (!seedId) {
        haptic('soft');
        notify('info', waiting.length ? 'Pick a seed from the tray first.' : 'Finish a focus session to earn a seed.');
        return;
      }
      const res = plant(seedId, hit.x, hit.y);
      if (!res.ok) return;
      const { sx, sy } = tileToScreen(layout, hit.x, hit.y);
      setPopped(key);
      setBurstAt((b) => ({ x: sx, y: sy, n: b.n + 1 }));
      burst.value = 0;
      burst.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) });
      haptic('medium');
      playSound('plant');
      if (res.islandGrew) {
        timers.current.push(
          setTimeout(() => {
            haptic('success');
            playSound('grow');
            islandScale.value = withSequence(
              withTiming(0.86, { duration: 120, easing: Easing.out(Easing.quad) }),
              withSpring(1, motion.pop),
            );
            setGrewBanner(true);
          }, 450),
          setTimeout(() => setGrewBanner(false), 3600),
        );
      }
    },
    [burst, islandScale, layout, notify, plant, seedId, tile, waiting.length, world.radius, world.tiles],
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
    if (select && pouchSeed) setSeedId(pouchSeed.seed.id);
    setPouchSeed(null);
    setImmersive(false);
  };
  useEffect(() => () => setImmersive(false), [setImmersive]);

  const mood = moodOf(target);
  const fadingIn = hoursUntilFading(world, now());
  const toFull = minutesToFullVitality(world, now());
  const planted = Object.keys(world.tiles).length;
  const moodDetail =
    world.graceUntil == null
      ? 'Finish a session to earn your first seed'
      : fadingIn > 0
        ? `Stays green for ${fadingIn >= 1 ? `${Math.floor(fadingIn)}h` : 'under an hour'} without focus`
        : target >= 0.985
          ? 'Focus 10+ minutes today to keep it green'
          : `${toFull} min of focus brings it fully back`;
  const untilGrow = plantsUntilExpansion(world);
  const ink = palette.dark ? colors.white : colors.ink;

  const selectedTileSeed = tile ? game.seeds[world.tiles[tile]] : null;
  const selectedSeed = seedId ? game.seeds[seedId] : null;

  return (
    <View style={StyleSheet.absoluteFill} testID="island-screen">
      <Canvas style={StyleSheet.absoluteFill}>
        <Sky w={w} h={h} palette={palette} clock={clock} />
        <Island
          layout={layout}
          world={world}
          seeds={game.seeds}
          vitality={vitality}
          clock={clock}
          showFreeTiles={!!selectedSeed && !tile}
          selectedTile={tile}
          poppedTile={popped}
          scale={islandScale}
        />
        <Burst
          key={burstAt.n}
          t={burst}
          x={burstAt.x}
          y={burstAt.y}
          colors={['#FFFFFF', colors.leafLight, colors.coin]}
          count={22}
          reach={70}
          gravity={50}
          size={5}
          seed={burstAt.n + 2}
          upward
        />
      </Canvas>

      <Pressable style={StyleSheet.absoluteFill} onPress={onCanvasPress} testID="island-touch" accessibilityLabel="Island" />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <View style={styles.headerRow} pointerEvents="box-none">
          <View style={{ flex: 1 }} pointerEvents="none">
            <Txt weight="black" size={26} color={ink}>
              Your island
            </Txt>
            <Txt weight="heavy" size={13} color={ink} style={{ opacity: 0.75 }}>
              {planted === 0
                ? 'Nothing planted yet'
                : `${planted} ${planted === 1 ? 'plant' : 'plants'}${untilGrow > 0 ? ` · ${untilGrow} more and it grows` : ''}`}
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
          <Txt weight="bold" size={12.5} color={colors.inkSoft} style={{ marginTop: 6 }}>
            {moodDetail}
          </Txt>
        </View>

        {grewBanner && (
          <Animated.View entering={FadeInDown.springify().damping(10)} exiting={FadeOut.duration(400)} style={styles.banner}>
            <Txt weight="black" size={16} color={colors.white} center>
              Your island grew!
            </Txt>
          </Animated.View>
        )}
      </View>

      <View style={[styles.tray, { bottom: insets.bottom + 92 }]}>
        {selectedTileSeed ? (
          <Animated.View entering={FadeIn.duration(180)} style={styles.trayCard} testID="tile-card">
            <View style={[styles.iconWell, { backgroundColor: rarityTint[selectedTileSeed.rarity] }]}>
              <PlantIcon speciesId={selectedTileSeed.speciesId} size={52} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Txt weight="black" size={17}>
                {getSpecies(selectedTileSeed.speciesId).name}
              </Txt>
              <Txt weight="heavy" size={12.5} color={rarityColor[selectedTileSeed.rarity]}>
                {RARITY_LABEL[selectedTileSeed.rarity]}
              </Txt>
            </View>
            <PressableScale
              onPress={() => {
                const { x, y } = parseTile(tile!);
                dig(x, y);
                setTile(null);
                setSeedId(selectedTileSeed.id);
                playSound('drop');
              }}
              style={styles.digBtn}
              testID="dig-up"
            >
              <Txt weight="heavy" size={13}>
                Move
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
              {groups.length === 0 ? (
                <View style={styles.trayEmpty}>
                  <Txt weight="heavy" size={13.5} color={colors.inkSoft}>
                    No seeds waiting
                  </Txt>
                  <Txt weight="bold" size={12} color={colors.inkFaint}>
                    Every finished session drops one
                  </Txt>
                </View>
              ) : (
                groups.map((g) => {
                  const on = selectedSeed?.speciesId === g.speciesId;
                  const rarity = g.seeds[0].rarity;
                  return (
                    <PressableScale
                      key={g.speciesId}
                      feel="tick"
                      onPress={() => {
                        setTile(null);
                        setSeedId(g.seeds[0].id);
                      }}
                      testID={`seed-${g.speciesId}`}
                      accessibilityLabel={`${getSpecies(g.speciesId).name}, ${g.seeds.length} seeds`}
                      style={[
                        styles.seedSlot,
                        { backgroundColor: rarityTint[rarity], borderColor: on ? rarityColor[rarity] : 'transparent' },
                      ]}
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
                })
              )}
              {groups.length > 0 && (
                <PlantSheet
                  width={groups.length * 66}
                  height={58}
                  items={groups.map((g, i) => ({ speciesId: g.speciesId, cx: i * 66 + 29, top: 6, size: 46 }))}
                  style={{ position: 'absolute', left: 66, top: 10 }}
                />
              )}
            </ScrollView>
          </View>
        )}
        <Txt weight="heavy" size={12.5} color={ink} center style={{ marginTop: 6, opacity: 0.8 }}>
          {selectedTileSeed
            ? 'Move puts the seed back in your tray'
            : selectedSeed
              ? `Tap a free tile to plant your ${getSpecies(selectedSeed.speciesId).name}`
              : 'Tap a plant to see what it is'}
        </Txt>
      </View>

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
  banner: {
    alignSelf: 'center',
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.leaf,
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
