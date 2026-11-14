import { BlurMask, Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { haptic, hapticPattern, PATTERNS } from '../feel/haptics';
import { playSound, type SoundName } from '../feel/sound';
import { RARITY_LABEL, getSpecies } from '../game/species';
import type { Rarity, Seed } from '../game/types';
import { Burst } from '../render/Burst';
import { PlantBody, PlantGlow } from '../render/PlantSprite';
import { plantSprite } from '../render/plants';
import { Txt } from '../ui/kit';
import { colors, lighten, motion, radius, rarityColor } from '../ui/theme';

interface Props {
  seed: Seed;
  isNew: boolean;
  /** Where the seed starts falling from (screen coordinates). */
  from: { x: number; y: number };
  /** Content shown under the revealed plant (rewards, buttons). */
  children?: React.ReactNode;
}

const TAPS_TO_OPEN = 3;

const FEEL: Record<Rarity, { shake: number; particles: number; reach: number; suspense: number; sound: SoundName }> = {
  common: { shake: 0, particles: 24, reach: 130, suspense: 0, sound: 'reveal_common' },
  rare: { shake: 7, particles: 42, reach: 180, suspense: 0, sound: 'reveal_rare' },
  epic: { shake: 12, particles: 60, reach: 230, suspense: 450, sound: 'reveal_epic' },
  legendary: { shake: 20, particles: 90, reach: 300, suspense: 900, sound: 'reveal_legendary' },
};

/**
 * The seed drop and reveal: the seed falls and bounces, the player taps it
 * three times to crack it open, and the plant bursts out. The rarer the seed,
 * the longer the suspense and the bigger the burst, shake and haptics.
 */
export function SeedReveal({ seed, isNew, from, children }: Props) {
  const { width: w, height: h } = useWindowDimensions();
  const species = getSpecies(seed.speciesId);
  const feel = FEEL[seed.rarity];
  const tint = rarityColor[seed.rarity];
  const cx = w / 2;
  const groundY = h * 0.42;
  const seedR = Math.min(w * 0.11, 46);

  const [taps, setTaps] = useState(0);
  const [stage, setStage] = useState<'drop' | 'wait' | 'suspense' | 'open'>('drop');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const clock = useSharedValue(0);
  const seedX = useSharedValue(from.x);
  const seedY = useSharedValue(from.y);
  const squash = useSharedValue(0);
  const tilt = useSharedValue(0);
  const seedScale = useSharedValue(0.4);
  const crackGlow = useSharedValue(0);
  const flash = useSharedValue(0);
  const burst = useSharedValue(0);
  const puff = useSharedValue(0);
  const plant = useSharedValue(0);
  const rays = useSharedValue(0);
  const shakeX = useSharedValue(0);
  const shakeY = useSharedValue(0);
  const dim = useSharedValue(0);

  // The drop: fall with a bounce, squash on the first impact.
  useEffect(() => {
    clock.value = withRepeat(withTiming(1, { duration: 6000, easing: Easing.linear }), -1);
    dim.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) });
    seedScale.value = withSpring(1, motion.pop);
    seedX.value = withTiming(cx, { duration: 700, easing: Easing.out(Easing.cubic) });
    seedY.value = withTiming(groundY, { duration: 900, easing: Easing.bounce });
    squash.value = withDelay(
      300,
      withSequence(withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }), withSpring(0, motion.wobble)),
    );
    later(330, () => {
      haptic('medium');
      playSound('drop');
    });
    later(650, () => {
      haptic('light');
      playSound('drop', 0.5);
    });
    later(950, () => setStage('wait'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While waiting, the seed wiggles now and then to invite a tap.
  useEffect(() => {
    if (stage !== 'wait') return;
    const id = setInterval(() => {
      tilt.value = withSequence(
        withTiming(0.16, { duration: 90, easing: Easing.out(Easing.quad) }),
        withTiming(-0.14, { duration: 120, easing: Easing.inOut(Easing.quad) }),
        withSpring(0, motion.wobble),
      );
    }, 2200);
    return () => clearInterval(id);
  }, [stage, tilt]);

  const open = useCallback(() => {
    setStage('open');
    playSound(feel.sound);
    if (seed.rarity === 'common') haptic('success');
    else hapticPattern(PATTERNS[seed.rarity]);
    seedScale.value = withTiming(0, { duration: 140, easing: Easing.in(Easing.back(2)) });
    flash.value = 0;
    flash.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) });
    burst.value = 0;
    burst.value = withTiming(1, { duration: 1500 + feel.reach * 2, easing: Easing.out(Easing.quad) });
    plant.value = withDelay(90, withSpring(1, motion.pop));
    rays.value = withDelay(120, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
    if (feel.shake > 0) {
      const a = feel.shake;
      const step = (v: number) => withTiming(v, { duration: 45, easing: Easing.inOut(Easing.quad) });
      shakeX.value = withSequence(step(a), step(-a * 0.8), step(a * 0.6), step(-a * 0.45), step(a * 0.3), step(-a * 0.15), step(0));
      shakeY.value = withSequence(step(-a * 0.6), step(a * 0.7), step(-a * 0.4), step(a * 0.3), step(-a * 0.2), step(0));
    }
  }, [burst, feel, flash, plant, rays, seed.rarity, seedScale, shakeX, shakeY]);

  const onTap = useCallback(() => {
    if (stage !== 'wait') return;
    const n = taps + 1;
    setTaps(n);
    haptic(n === 1 ? 'light' : n === 2 ? 'medium' : 'heavy');
    playSound('crack', 0.5 + n * 0.15);
    squash.value = withSequence(withTiming(0.8, { duration: 60, easing: Easing.out(Easing.quad) }), withSpring(0, motion.wobble));
    tilt.value = withSequence(
      withTiming(n % 2 ? 0.22 : -0.22, { duration: 70, easing: Easing.out(Easing.quad) }),
      withSpring(0, motion.wobble),
    );
    puff.value = 0;
    puff.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) });
    crackGlow.value = withTiming(n / TAPS_TO_OPEN, { duration: 250, easing: Easing.out(Easing.quad) });
    if (n < TAPS_TO_OPEN) return;

    if (feel.suspense > 0) {
      // Rare things make you wait: the seed trembles harder and harder first.
      setStage('suspense');
      const beats = Math.floor(feel.suspense / 75);
      tilt.value = withSequence(
        ...Array.from({ length: beats }, (_, i) =>
          withTiming((i % 2 ? -1 : 1) * (0.05 + (i / beats) * 0.22), { duration: 75, easing: Easing.inOut(Easing.quad) }),
        ),
        withTiming(0, { duration: 40 }),
      );
      seedScale.value = withTiming(1.25, { duration: feel.suspense, easing: Easing.in(Easing.quad) });
      for (let i = 0; i < beats; i += 2) later(i * 75, () => haptic(i > beats * 0.6 ? 'medium' : 'light'));
      later(feel.suspense, open);
    } else {
      later(90, open);
    }
  }, [crackGlow, feel, later, open, puff, seedScale, squash, stage, taps, tilt]);

  // --- drawing -------------------------------------------------------------
  const seedPath = useMemo(
    () =>
      Skia.PathBuilder.Make()
        .moveTo(0, -seedR * 1.25)
        .cubicTo(seedR * 1.15, -seedR * 0.7, seedR * 1.05, seedR, 0, seedR)
        .cubicTo(-seedR * 1.05, seedR, -seedR * 1.15, -seedR * 0.7, 0, -seedR * 1.25)
        .close()
        .build(),
    [seedR],
  );
  const cracks = useMemo(() => {
    const mk = (pts: [number, number][]) => {
      const b = Skia.PathBuilder.Make();
      pts.forEach(([x, y], i) => (i === 0 ? b.moveTo(x * seedR, y * seedR) : b.lineTo(x * seedR, y * seedR)));
      return b.build();
    };
    return [
      mk([[-0.1, -1.1], [0.12, -0.6], [-0.08, -0.25], [0.1, 0.1]]),
      mk([[0.12, -0.6], [0.5, -0.4], [0.62, -0.05]]),
      mk([[-0.08, -0.25], [-0.5, -0.05], [-0.55, 0.4]]),
    ];
  }, [seedR]);

  const sprite = useMemo(() => plantSprite(species.id, Math.min(w * 0.3, 130) / Math.max(1, species.size * 0.75)), [species, w]);
  const rayPath = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    const n = 12;
    const R = Math.max(w, h) * 0.7;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / n / 2.4;
      b.moveTo(0, 0).lineTo(Math.cos(a0) * R, Math.sin(a0) * R).lineTo(Math.cos(a1) * R, Math.sin(a1) * R).close();
    }
    return b.build();
  }, [w, h]);

  const seedTransform = useDerivedValue(() => [
    { translateX: seedX.value },
    { translateY: seedY.value },
    { rotate: tilt.value },
    { scaleX: seedScale.value * (1 + squash.value * 0.28) },
    { scaleY: seedScale.value * (1 - squash.value * 0.26) },
  ]);
  const crackOpacity = (i: number) => (taps > i ? 1 : 0);
  const glowOpacity = useDerivedValue(() => crackGlow.value * 0.85 * (seedScale.value > 0.05 ? 1 : 0));
  const glowR = useDerivedValue(() => seedR * (1.2 + crackGlow.value * 1.1));
  const flashR = useDerivedValue(() => seedR + flash.value * Math.max(w, h) * 0.75);
  const flashOpacity = useDerivedValue(() => (flash.value <= 0 ? 0 : (1 - flash.value) * 0.9));
  const plantY = groundY + sprite.height * 0.42;
  const plantTransform = useDerivedValue(() => [
    { translateX: cx },
    { translateY: plantY },
    { rotate: Math.sin(clock.value * Math.PI * 2 * 3) * 0.03 },
    { scale: plant.value },
  ]);
  const raysTransform = useDerivedValue(() => [
    { translateX: cx },
    { translateY: groundY },
    { rotate: clock.value * Math.PI * 2 },
  ]);
  const raysOpacity = useDerivedValue(() => rays.value * (seed.rarity === 'legendary' ? 0.34 : seed.rarity === 'epic' ? 0.24 : 0.14));
  const haloOpacity = useDerivedValue(() => rays.value * 0.55);

  const rootStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }, { translateY: shakeY.value }] }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));

  const revealed = stage === 'open';
  const burstColors: [string, string, string] = [tint, lighten(tint, 0.45), species.primary === '#FFFFFF' ? colors.coin : species.primary];

  return (
    <Animated.View style={[StyleSheet.absoluteFill, rootStyle]} testID="seed-reveal">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(14, 30, 22, 0.84)' }, dimStyle]} />
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {seed.rarity !== 'common' && (
          <Group transform={raysTransform} opacity={raysOpacity}>
            <Path path={rayPath} color={tint} />
          </Group>
        )}
        <Circle cx={cx} cy={groundY} r={Math.min(w * 0.42, 190)} color={tint} opacity={haloOpacity}>
          <BlurMask blur={50} style="normal" />
        </Circle>

        <Circle cx={seedX} cy={seedY} r={glowR} color={tint} opacity={glowOpacity}>
          <BlurMask blur={seedR * 0.6} style="normal" />
        </Circle>
        <Group transform={seedTransform}>
          <Path path={seedPath} color="#8A5A3C" />
          <Path path={seedPath} color="#6B442C" style="stroke" strokeWidth={3} />
          <Circle cx={-seedR * 0.35} cy={-seedR * 0.35} r={seedR * 0.22} color="#C69A6D" opacity={0.75} />
          {cracks.map((c, i) => (
            <Group key={i} opacity={crackOpacity(i)}>
              <Path path={c} color={tint} style="stroke" strokeWidth={7} strokeCap="round" strokeJoin="round" opacity={0.55}>
                <BlurMask blur={4} style="normal" />
              </Path>
              <Path path={c} color="#FFF8E7" style="stroke" strokeWidth={2.5} strokeCap="round" strokeJoin="round" />
            </Group>
          ))}
        </Group>
        <Burst t={puff} x={cx} y={groundY} colors={['#C69A6D', '#8A5A3C', '#FFF8E7']} count={12} reach={70} gravity={60} size={4} seed={taps + 3} />

        <Group transform={plantTransform}>
          <PlantGlow parts={sprite.parts} />
          <PlantBody parts={sprite.parts} />
        </Group>
        <Burst t={burst} x={cx} y={groundY} colors={burstColors} count={feel.particles} reach={feel.reach} gravity={180} size={7} seed={11} />
        <Circle cx={cx} cy={groundY} r={flashR} color="#FFFFFF" opacity={flashOpacity} />
      </Canvas>

      {!revealed && (
        <Pressable style={StyleSheet.absoluteFill} onPress={onTap} testID="seed-tap" accessibilityLabel="Tap the seed to open it">
          {stage === 'wait' && (
            <Animated.View entering={FadeIn.duration(400)} style={[styles.hint, { top: groundY + seedR * 2.2 }]}>
              <Txt weight="heavy" size={17} color={colors.white} center>
                {taps === 0 ? 'A seed dropped. Tap it!' : taps === 1 ? 'It is cracking...' : 'One more!'}
              </Txt>
            </Animated.View>
          )}
        </Pressable>
      )}

      {revealed && (
        <RevealCard top={groundY + sprite.height * 0.42 + 26} rarity={seed.rarity} name={species.name} blurb={species.blurb} isNew={isNew}>
          {children}
        </RevealCard>
      )}
    </Animated.View>
  );
}

function RevealCard({
  top,
  rarity,
  name,
  blurb,
  isNew,
  children,
}: {
  top: number;
  rarity: Rarity;
  name: string;
  blurb: string;
  isNew: boolean;
  children?: React.ReactNode;
}) {
  const y = useSharedValue(60);
  const o = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(450, withSpring(0, motion.settle));
    o.value = withDelay(450, withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }));
  }, [o, y]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  return (
    <Animated.View style={[styles.cardWrap, { top }, anim]} testID="reveal-card">
      <View style={styles.badges}>
        <View style={[styles.badge, { backgroundColor: rarityColor[rarity] }]}>
          <Txt weight="black" size={12} color={colors.white} style={{ letterSpacing: 1 }}>
            {RARITY_LABEL[rarity].toUpperCase()}
          </Txt>
        </View>
        {isNew && (
          <View style={[styles.badge, { backgroundColor: colors.white, marginLeft: 8 }]}>
            <Txt weight="black" size={12} color={colors.ink} style={{ letterSpacing: 1 }}>
              NEW
            </Txt>
          </View>
        )}
      </View>
      <Txt weight="black" size={30} color={colors.white} center style={{ marginTop: 8 }}>
        {name}
      </Txt>
      <Txt weight="regular" size={15} color="rgba(255,255,255,0.85)" center style={{ marginTop: 4, marginBottom: 16 }}>
        {blurb}
      </Txt>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  cardWrap: { position: 'absolute', left: 24, right: 24, alignItems: 'stretch' },
  badges: { flexDirection: 'row', justifyContent: 'center' },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill },
});
