import { Canvas, ColorMatrix, Group, Paint } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '../feel/haptics';
import { playSound, type SoundName } from '../feel/sound';
import { CONFIG } from '../game/config';
import { maxStake, wagerPayout } from '../game/economy';
import { gracesLeft, sessionProgress } from '../game/engine';
import { rarityOdds } from '../game/rewards';
import { ringProgress, streakAtRisk } from '../game/streak';
import { dayIndex, dayKey, formatClock, formatMinutes } from '../game/time';
import type { CompletionSummary, WitherSummary } from '../game/types';
import { Sapling, saplingTip, wiltMatrix } from '../render/Sapling';
import { useClockMs } from '../render/clock';
import { Hill, Sky } from '../render/scene';
import { useStore } from '../store/store';
import { Ring } from '../ui/Ring';
import { Button, CoinIcon, Pill, PressableScale, Txt } from '../ui/kit';
import { colors, motion, radius, skyForHour } from '../ui/theme';
import { SeedReveal } from './SeedReveal';

const MILESTONES = CONFIG.session.milestones;
const BUD_AT = 0.5;
const LEAF_SOUNDS: SoundName[] = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];
const DIAL_ITEM = 58;

function durationOptions(dev: boolean): number[] {
  const out: number[] = dev ? [10] : [];
  out.push(60);
  for (let m = 5; m <= 120; m += 5) out.push(m * 60);
  return out;
}

function durationLabel(sec: number) {
  return sec < 60 ? `${sec}s` : `${sec / 60}`;
}

export function FocusScreen({ onPlant }: { onPlant: (seedId: string) => void }) {
  const { width: w, height: h } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const active = useStore((s) => s.game.active);
  const result = useStore((s) => s.result);
  const now = useStore((s) => s.now);
  const dismissResult = useStore((s) => s.dismissResult);

  const palette = useMemo(() => skyForHour(new Date(now()).getHours()), [now, active, result]);
  const [dimmed, setDimmed] = useState(false);
  const clock = useClockMs(!dimmed);

  const baseY = h * 0.72;
  const saplingH = Math.min(h * 0.3, 290);
  const tip = saplingTip(saplingH);

  // Everything that moves the sapling lives here so it survives phase changes.
  const progress = useSharedValue(0);
  const wilt = useSharedValue(0);
  const pulse = useSharedValue(0);
  const appear = useSharedValue(0);
  const bud = useSharedValue(0);
  const l0 = useSharedValue(0);
  const l1 = useSharedValue(0);
  const l2 = useSharedValue(0);
  const l3 = useSharedValue(0);
  const leaves = useMemo(() => [l0, l1, l2, l3], [l0, l1, l2, l3]);
  /** 0 = idle (hill resting low), 1 = session scene. */
  const stage = useSharedValue(0);

  const popped = useRef(0);
  const budShown = useRef(false);
  const [showReveal, setShowReveal] = useState(false);
  const [showWitherCard, setShowWitherCard] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const squashStretch = useCallback(
    (strength = 0.7) => {
      pulse.value = withSequence(
        withTiming(-strength, { duration: 90, easing: Easing.out(Easing.quad) }),
        withSpring(0, motion.wobble),
      );
    },
    [pulse],
  );

  /** Put the sapling into the state it has at progress p, without fanfare. */
  const snapTo = useCallback(
    (p: number) => {
      progress.value = p;
      let count = 0;
      MILESTONES.forEach((m, i) => {
        const on = p >= m;
        leaves[i].value = on ? 1 : 0;
        if (on) count++;
      });
      popped.current = count;
      budShown.current = p >= BUD_AT;
      bud.value = budShown.current ? 1 : 0;
    },
    [bud, leaves, progress],
  );

  // A session started (or was already running when this screen mounted).
  const activeId = active?.id;
  useEffect(() => {
    const a = useStore.getState().game.active;
    if (!a) return;
    const p = sessionProgress(a, now());
    cancelAnimation(wilt);
    wilt.value = 0;
    snapTo(p);
    stage.value = withSpring(1, motion.settle);
    if (p < 0.02) {
      appear.value = 0;
      appear.value = withDelay(260, withSpring(1, motion.pop));
    } else {
      appear.value = 1;
    }
    setShowReveal(false);
    setShowWitherCard(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // While running: follow the clock, pop leaves at milestones.
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!activeId) return;
    const update = () => {
      const a = useStore.getState().game.active;
      if (!a) return;
      const t = now();
      const p = sessionProgress(a, t);
      progress.value = withTiming(p, { duration: 240, easing: Easing.linear });
      setRemaining((a.startedAt + a.durationSec * 1000 - t) / 1000);
      while (popped.current < MILESTONES.length && p >= MILESTONES[popped.current]) {
        const i = popped.current++;
        leaves[i].value = withSpring(1, motion.pop);
        squashStretch(0.55);
        haptic(i === MILESTONES.length - 1 ? 'medium' : 'light');
        playSound(LEAF_SOUNDS[i], 0.8);
      }
      if (!budShown.current && p >= BUD_AT) {
        budShown.current = true;
        bud.value = withSpring(1, motion.pop);
      }
    };
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // The session ended.
  const resultId = result?.summary.session.id;
  useEffect(() => {
    if (!result) return;
    const session = result.summary.session;
    stage.value = withSpring(1, motion.settle);
    appear.value = withSpring(1, motion.settle);
    if (result.kind === 'completed') {
      progress.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
      MILESTONES.forEach((_, i) => {
        if (i >= popped.current) leaves[i].value = withSpring(1, motion.pop);
      });
      popped.current = MILESTONES.length;
      haptic('success');
      playSound('complete');
      squashStretch(1);
      bud.value = withSequence(
        withSpring(1.35, motion.pop),
        withDelay(250, withTiming(1.7, { duration: 260, easing: Easing.in(Easing.quad) })),
        withTiming(0, { duration: 90, easing: Easing.in(Easing.quad) }),
      );
      later(1050, () => setShowReveal(true));
    } else {
      // Show the sapling as it was when it was abandoned, then let it wither slowly.
      const p = Math.min(1, Math.max(0, (session.endedAt - session.startedAt) / (session.durationSec * 1000)));
      snapTo(p);
      const play = () => {
        wilt.value = withDelay(250, withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.cubic) }));
        later(250, () => {
          haptic('error');
          playSound('wither');
        });
        later(1500, () => setShowWitherCard(true));
      };
      // A sapling can wither while the app is in the background. Keep the
      // moment for when the player is back to see (and hear) it.
      if (AppState.currentState === 'active') {
        play();
      } else {
        const sub = AppState.addEventListener('change', (state) => {
          if (state !== 'active') return;
          sub.remove();
          play();
        });
        return () => sub.remove();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultId]);

  // Back to idle: the hill sinks back and the sapling leaves the stage.
  const idle = !active && !result;
  useEffect(() => {
    if (!idle) return;
    stage.value = withSpring(0, motion.settle);
    appear.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.quad) });
    setShowReveal(false);
    setShowWitherCard(false);
    setDimmed(false);
  }, [idle, appear, stage]);

  const hillShift = useDerivedValue(() => [{ translateY: (1 - stage.value) * h * 0.16 }]);
  const matrix = useDerivedValue(() => wiltMatrix(wilt.value));
  const withering = result?.kind === 'withered';

  const scene = (
    <>
      <Sky w={w} h={h} palette={palette} clock={clock} />
      <Group transform={hillShift}>
        <Hill w={w} h={h} crestY={baseY - 18} dark={palette.dark} />
        <Sapling
          x={w / 2}
          y={baseY}
          height={saplingH}
          progress={progress}
          wilt={wilt}
          pulse={pulse}
          appear={appear}
          leaves={leaves}
          bud={bud}
          clock={clock}
        />
      </Group>
    </>
  );

  return (
    <View style={styles.fill} testID="focus-screen">
      <Canvas style={StyleSheet.absoluteFill}>
        {withering ? (
          <Group
            layer={
              <Paint>
                <ColorMatrix matrix={matrix} />
              </Paint>
            }
          >
            {scene}
          </Group>
        ) : (
          <Group>{scene}</Group>
        )}
      </Canvas>

      {idle && <IdleControls dark={palette.dark} top={insets.top} />}

      {active && (
        <SessionOverlay
          remaining={remaining}
          dark={palette.dark}
          top={insets.top}
          bottom={insets.bottom}
          dimmed={dimmed}
          setDimmed={setDimmed}
        />
      )}

      {result?.kind === 'completed' && showReveal && (
        <SeedReveal
          seed={result.summary.seed}
          isNew={result.summary.isNewSpecies}
          from={{ x: w / 2 + tip.x, y: baseY + tip.y }}
        >
          <CompletionRewards
            summary={result.summary}
            onPlant={() => {
              const id = result.summary.seed.id;
              dismissResult();
              onPlant(id);
            }}
            onDone={dismissResult}
          />
        </SeedReveal>
      )}

      {result?.kind === 'withered' && showWitherCard && (
        <WitherCard summary={result.summary} top={insets.top} onDone={dismissResult} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Idle: ring, duration dial, wager, start
// ---------------------------------------------------------------------------

function IdleControls({ dark, top }: { dark: boolean; top: number }) {
  const { width: w, height: h } = useWindowDimensions();
  const coins = useStore((s) => s.game.economy.coins);
  const progress = useStore((s) => s.game.progress);
  const settings = useStore((s) => s.settings);
  const start = useStore((s) => s.start);
  const now = useStore((s) => s.now);
  const updateSettings = useStore((s) => s.updateSettings);

  const options = useMemo(() => durationOptions(settings.devTools), [settings.devTools]);
  const initial = options.includes(settings.lastDurationMin * 60) ? settings.lastDurationMin * 60 : 25 * 60;
  const [durationSec, setDurationSec] = useState(initial);
  const [stake, setStake] = useState(0);

  const today = dayIndex(now());
  const todayKey = dayKey(today);
  const ring = ringProgress(progress, todayKey);
  const todayMin = progress.days[todayKey] ?? 0;
  const atRisk = streakAtRisk(progress, today);

  const cap = maxStake(durationSec, coins);
  useEffect(() => {
    if (stake > cap) setStake(cap);
  }, [cap, stake]);
  const stakeOptions = useMemo(() => {
    const half = Math.floor(cap / 2);
    return Array.from(new Set([0, half, cap])).filter((v, i) => i === 0 || v > 0);
  }, [cap]);

  const minutes = durationSec / 60;
  const odds = rarityOdds(minutes, progress.pityCounter);
  const rarePlus = Math.round((1 - odds.common) * 100);
  const ink = dark ? colors.white : colors.ink;
  const inkSoft = dark ? 'rgba(255,255,255,0.8)' : colors.inkSoft;

  const ringSize = Math.min(w * 0.6, h * 0.3, 260);
  const ringScale = useSharedValue(1);
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: ringScale.value }] }));
  const numberScale = useSharedValue(1);
  const numberStyle = useAnimatedStyle(() => ({ transform: [{ scale: numberScale.value }] }));

  // The start button breathes while it waits.
  const breathe = useSharedValue(0);
  useEffect(() => {
    breathe.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
  }, [breathe]);
  const breatheStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + breathe.value * 0.025 }] }));

  const onDuration = useCallback(
    (sec: number) => {
      setDurationSec(sec);
      numberScale.value = withSequence(withTiming(1.12, { duration: 70, easing: Easing.out(Easing.quad) }), withSpring(1, motion.wobble));
    },
    [numberScale],
  );

  const onStart = () => {
    haptic('heavy');
    playSound('start');
    if (durationSec >= 60) updateSettings({ lastDurationMin: durationSec / 60 });
    start(durationSec, stake);
  };

  return (
    <Animated.View
      entering={FadeIn.duration(350)}
      exiting={FadeOut.duration(200)}
      style={[styles.fill, { paddingTop: top + 10, paddingBottom: 96 }]}
    >
      <View style={styles.topBar}>
        <View style={styles.row}>
          <Pill
            icon={<Txt size={15}>🔥</Txt>}
            value={progress.streak}
            tint={atRisk ? '#FFE3D1' : undefined}
            color={atRisk ? '#C2531A' : colors.ink}
          />
          <Pill icon={<Txt size={14}>❄️</Txt>} value={progress.freezes} style={{ marginLeft: 8 }} />
        </View>
        <Pill icon={<CoinIcon size={18} />} value={coins} />
      </View>
      {atRisk && (
        <Txt size={13} color={dark ? '#FFD9C2' : '#C2531A'} center style={{ marginTop: 6 }}>
          {`Focus ${CONFIG.streak.minQualifyingMin}+ minutes today to keep your streak`}
        </Txt>
      )}

      <View style={styles.ringArea}>
        <Pressable
          onPressIn={() => {
            ringScale.value = withSpring(0.94, motion.press);
            haptic('soft');
          }}
          onPressOut={() => {
            ringScale.value = withSpring(1, motion.wobble);
            playSound('tap', 0.5);
          }}
          accessibilityLabel={`Today ${Math.floor(todayMin)} of ${progress.dailyGoalMin} minutes`}
        >
          <Animated.View style={[{ width: ringSize, height: ringSize }, ringStyle]}>
            <Ring size={ringSize} progress={ring} trackColor={dark ? 'rgba(255,255,255,0.18)' : 'rgba(31,61,43,0.12)'} />
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Animated.View style={[styles.center, numberStyle]}>
                <Txt weight="black" size={ringSize * 0.3} color={ink} style={{ lineHeight: ringSize * 0.34 }}>
                  {durationLabel(durationSec)}
                </Txt>
                <Txt weight="heavy" size={14} color={inkSoft} style={{ marginTop: -4 }}>
                  {durationSec < 60 ? 'test session' : minutes === 1 ? 'minute' : 'minutes'}
                </Txt>
              </Animated.View>
            </View>
          </Animated.View>
        </Pressable>
        <Txt weight="heavy" size={14} color={inkSoft} style={{ marginTop: 10 }} testID="today-progress">
          {ring >= 1
            ? `Ring closed · ${formatMinutes(todayMin)} today`
            : `Today ${formatMinutes(todayMin)} of ${formatMinutes(progress.dailyGoalMin)}`}
        </Txt>
      </View>

      <Dial options={options} value={durationSec} onChange={onDuration} dark={dark} />

      <View style={styles.wager}>
        <View style={styles.wagerChips}>
          {stakeOptions.map((v) => {
            const on = v === stake;
            return (
              <PressableScale
                key={v}
                feel="tick"
                onPress={() => setStake(v)}
                testID={`stake-${v}`}
                style={[styles.chip, on && styles.chipOn]}
              >
                {v > 0 && <CoinIcon size={14} />}
                <Txt weight="heavy" size={14} color={on ? colors.white : colors.ink} style={{ marginLeft: v > 0 ? 5 : 0 }}>
                  {v === 0 ? 'No wager' : v}
                </Txt>
              </PressableScale>
            );
          })}
        </View>
        <Txt size={12.5} color={inkSoft} center style={{ marginTop: 6 }}>
          {cap === 0
            ? coins === 0
              ? 'Earn coins by focusing, then wager them'
              : 'This session is too short to wager on'
            : stake > 0
              ? `Finish to win ${wagerPayout(stake)} back · leave and lose ${stake}`
              : 'Stake coins on yourself for 1.5x back'}
        </Txt>
      </View>

      <View style={styles.startArea}>
        <Animated.View style={breatheStyle}>
          <Button
            label="Start focusing"
            sub={`${rarePlus}% chance of a rare seed or better`}
            onPress={onStart}
            feel="none"
            testID="start-button"
            style={{ minWidth: w * 0.74, minHeight: 66 }}
          />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function Dial({
  options,
  value,
  onChange,
  dark,
}: {
  options: number[];
  value: number;
  onChange: (sec: number) => void;
  dark: boolean;
}) {
  const { width: w } = useWindowDimensions();
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const index = Math.max(0, options.indexOf(value));
  const current = useRef(index);
  const pad = (w - DIAL_ITEM) / 2;

  useEffect(() => {
    // Position the dial on the remembered duration.
    const id = setTimeout(() => ref.current?.scrollTo({ x: current.current * DIAL_ITEM, animated: false }), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(options.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / DIAL_ITEM)));
    if (i !== current.current) {
      current.current = i;
      haptic('tick');
      playSound('tick', 0.7);
      onChange(options[i]);
    }
  };

  const ink = dark ? colors.white : colors.ink;
  return (
    <View style={styles.dial} testID="duration-dial">
      <View pointerEvents="none" style={[styles.dialMarker, { left: w / 2 - DIAL_ITEM / 2 }]} />
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={DIAL_ITEM}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentOffset={{ x: index * DIAL_ITEM, y: 0 }}
        contentContainerStyle={{ paddingHorizontal: pad }}
      >
        {options.map((sec, i) => {
          const on = i === index;
          return (
            <Pressable
              key={sec}
              onPress={() => ref.current?.scrollTo({ x: i * DIAL_ITEM, animated: true })}
              style={styles.dialItem}
              testID={`duration-${sec}`}
              accessibilityLabel={sec < 60 ? `${sec} second test session` : `${sec / 60} minute session`}
            >
              <Txt weight={on ? 'black' : 'bold'} size={on ? 22 : 16} color={ink} style={{ opacity: on ? 1 : 0.5 }}>
                {durationLabel(sec)}
              </Txt>
              <View style={[styles.dialTick, { backgroundColor: ink, opacity: on ? 0.9 : 0.25, height: on ? 10 : 6 }]} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function SessionOverlay({
  remaining,
  dark,
  top,
  bottom,
  dimmed,
  setDimmed,
}: {
  remaining: number;
  dark: boolean;
  top: number;
  bottom: number;
  dimmed: boolean;
  setDimmed: (v: boolean) => void;
}) {
  const { height: h } = useWindowDimensions();
  const active = useStore((s) => s.game.active);
  const giveUp = useStore((s) => s.giveUp);
  const ink = dark ? colors.white : colors.ink;
  const inkSoft = dark ? 'rgba(255,255,255,0.8)' : colors.inkSoft;

  // Dim the screen after a while without touches: calmer, and kinder to the battery.
  const dimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useCallback(() => {
    setDimmed(false);
    if (dimTimer.current) clearTimeout(dimTimer.current);
    dimTimer.current = setTimeout(() => setDimmed(true), 25_000);
  }, [setDimmed]);
  useEffect(() => {
    wake();
    return () => {
      if (dimTimer.current) clearTimeout(dimTimer.current);
    };
  }, [wake]);
  const dim = useSharedValue(0);
  useEffect(() => {
    dim.value = withTiming(dimmed ? 0.62 : 0, { duration: dimmed ? 1800 : 250, easing: Easing.inOut(Easing.quad) });
  }, [dim, dimmed]);
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));

  // A warning whenever a grace was just used.
  const graces = active ? gracesLeft(active) : CONFIG.session.maxGraces;
  const lastGraces = useRef(graces);
  const [warning, setWarning] = useState<string | null>(null);
  useEffect(() => {
    if (graces < lastGraces.current) {
      haptic('warning');
      playSound('warn');
      setWarning(
        graces === 0
          ? 'Welcome back. That was your last second chance.'
          : `Welcome back. ${graces} second ${graces === 1 ? 'chance' : 'chances'} left.`,
      );
      const id = setTimeout(() => setWarning(null), 4000);
      lastGraces.current = graces;
      return () => clearTimeout(id);
    }
    lastGraces.current = graces;
  }, [graces]);

  // Hold to give up.
  const hold = useSharedValue(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStyle = useAnimatedStyle(() => ({ width: `${hold.value * 100}%` }));
  const beginHold = () => {
    wake();
    haptic('light');
    hold.value = withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) });
    holdTimer.current = setTimeout(() => {
      haptic('heavy');
      giveUp();
    }, 1500);
  };
  const endHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    hold.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) });
  };
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  if (!active) return null;
  return (
    <Animated.View entering={FadeIn.delay(200).duration(400)} exiting={FadeOut.duration(200)} style={styles.fill} onTouchStart={wake}>
      <View style={[styles.sessionTop, { paddingTop: Math.max(top + 28, h * 0.19) }]}>
        <Txt weight="black" size={68} color={ink} style={styles.timer} testID="timer">
          {formatClock(remaining)}
        </Txt>
        <Txt weight="heavy" size={15} color={inkSoft} center style={{ marginTop: 2 }}>
          Stay here while your sapling grows
        </Txt>
        {active.stake > 0 && (
          <View style={styles.stakeChip}>
            <CoinIcon size={15} />
            <Txt weight="heavy" size={14} style={{ marginLeft: 6 }}>
              {`${active.stake} at stake · ${wagerPayout(active.stake)} if you finish`}
            </Txt>
          </View>
        )}
        {warning && (
          <Animated.View entering={FadeInDown.springify().damping(12)} exiting={FadeOut.duration(300)} style={styles.warning}>
            <Txt weight="heavy" size={14} color={colors.white} center>
              {warning}
            </Txt>
          </Animated.View>
        )}
      </View>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#07120C' }, dimStyle]} />

      <View style={[styles.sessionBottom, { paddingBottom: bottom + 22 }]}>
        <Pressable
          onPressIn={beginHold}
          onPressOut={endHold}
          style={styles.giveUp}
          testID="give-up"
          accessibilityLabel="Hold to give up this session"
        >
          <Animated.View style={[styles.giveUpFill, holdStyle]} />
          <Txt weight="heavy" size={14} color={colors.white}>
            Hold to give up
          </Txt>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function RewardRow({ icon, text, delay }: { icon: React.ReactNode; text: string; delay: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).springify().damping(11)} style={styles.rewardRow}>
      <View style={styles.rewardIcon}>{icon}</View>
      <Txt weight="heavy" size={15} color={colors.white} style={{ flex: 1 }}>
        {text}
      </Txt>
    </Animated.View>
  );
}

function CompletionRewards({
  summary,
  onPlant,
  onDone,
}: {
  summary: CompletionSummary;
  onPlant: () => void;
  onDone: () => void;
}) {
  const goal = useStore((s) => s.game.progress.dailyGoalMin);
  useEffect(() => {
    const ids = [
      setTimeout(() => {
        if (summary.coinsEarned + summary.payout > 0) {
          playSound('coin');
          haptic('light');
        }
      }, 900),
      setTimeout(() => {
        if (summary.ringClosedNow || summary.streakAfter > summary.streakBefore) haptic('success');
      }, 1300),
    ];
    return () => ids.forEach(clearTimeout);
  }, [summary]);

  const rows: { icon: React.ReactNode; text: string }[] = [];
  if (summary.coinsEarned > 0) rows.push({ icon: <CoinIcon size={18} />, text: `+${summary.coinsEarned} coins for ${formatMinutes(summary.minutes)} of focus` });
  if (summary.stake > 0) rows.push({ icon: <CoinIcon size={18} />, text: `Wager won: ${summary.stake} became ${summary.payout}` });
  if (summary.streakAfter > summary.streakBefore) rows.push({ icon: <Txt size={16}>🔥</Txt>, text: `${summary.streakAfter}-day streak` });
  else if (!summary.qualifiedForStreak)
    rows.push({ icon: <Txt size={16}>🔥</Txt>, text: `Sessions of ${CONFIG.streak.minQualifyingMin}+ minutes count for your streak` });
  if (summary.ringClosedNow) rows.push({ icon: <Txt size={16}>⭕</Txt>, text: 'Daily ring closed!' });
  else if (summary.ringAfter < 1)
    rows.push({ icon: <Txt size={16}>⭕</Txt>, text: `${formatMinutes(Math.max(1, (1 - summary.ringAfter) * goal))} left to close today's ring` });
  if (summary.freezeEarned) rows.push({ icon: <Txt size={16}>❄️</Txt>, text: 'Streak freeze earned' });
  if (summary.vitalityAfter - summary.vitalityBefore > 0.02 && summary.vitalityBefore < 0.9)
    rows.push({ icon: <Txt size={16}>💧</Txt>, text: 'Your island is coming back to life' });

  return (
    <View>
      {rows.slice(0, 4).map((r, i) => (
        <RewardRow key={i} icon={r.icon} text={r.text} delay={650 + i * 130} />
      ))}
      <Animated.View entering={FadeInDown.delay(1250).springify().damping(12)} style={{ marginTop: 14 }}>
        <Button label="Plant it" onPress={onPlant} testID="plant-it" />
        <Button label="Later" tone="ghost" onPress={onDone} testID="reveal-done" style={{ marginTop: 10, minHeight: 50 }} feel="light" />
      </Animated.View>
    </View>
  );
}

function WitherCard({ summary, top, onDone }: { summary: WitherSummary; top: number; onDone: () => void }) {
  const title = summary.reason === 'gaveUp' ? 'You let this one go' : 'Your sapling withered';
  const body =
    summary.reason === 'left'
      ? 'You were away from the app for too long.'
      : summary.reason === 'interrupted'
        ? 'The app was closed during the session.'
        : 'Sometimes it is not the moment. No harm done.';
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(13)}
      style={[styles.witherCard, { top: top + 44 }]}
      testID="wither-card"
    >
      <Txt weight="black" size={24} center>
        {title}
      </Txt>
      <Txt weight="regular" size={15} color={colors.inkSoft} center style={{ marginTop: 6 }}>
        {body}
      </Txt>
      {summary.stakeLost > 0 && (
        <View style={[styles.row, { justifyContent: 'center', marginTop: 10 }]}>
          <CoinIcon size={16} />
          <Txt weight="heavy" size={15} color={colors.danger} style={{ marginLeft: 6 }}>
            {`${summary.stakeLost} staked coins lost`}
          </Txt>
        </View>
      )}
      <Txt weight="regular" size={14} color={colors.inkFaint} center style={{ marginTop: 10 }}>
        Your island is untouched. The next seed is waiting.
      </Txt>
      <Button label="Try again" onPress={onDone} testID="wither-done" style={{ marginTop: 16 }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18 },
  ringArea: { flex: 1.5, alignItems: 'center', justifyContent: 'center' },
  dial: { height: 64, justifyContent: 'center' },
  dialMarker: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    width: DIAL_ITEM,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  dialItem: { width: DIAL_ITEM, height: 60, alignItems: 'center', justifyContent: 'center' },
  dialTick: { width: 2, borderRadius: 1, marginTop: 5 },
  wager: { marginTop: 14, paddingHorizontal: 18 },
  wagerChips: { flexDirection: 'row', justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    paddingHorizontal: 16,
    marginHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  chipOn: { backgroundColor: colors.ink },
  startArea: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 90 },
  sessionTop: { alignItems: 'center', paddingHorizontal: 24 },
  timer: { fontVariant: ['tabular-nums'], letterSpacing: 1 },
  stakeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  warning: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: '#C2531A',
  },
  sessionBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  giveUp: {
    height: 44,
    minWidth: 190,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(20, 40, 30, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  giveUpFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.danger },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginTop: 7,
  },
  rewardIcon: { width: 28, alignItems: 'center', marginRight: 6 },
  witherCard: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardEdge,
  },
});
