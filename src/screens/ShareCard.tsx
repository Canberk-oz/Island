import { Canvas, Group, RoundedRect, Text as SkText, useCanvasRef, useFont } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { haptic } from '../feel/haptics';
import { playSound } from '../feel/sound';
import { vitalityNow } from '../game/decay';
import { dayIndex, dayKey, formatMinutes, isoWeek, weekStart } from '../game/time';
import { Island, layoutIsland } from '../render/Island';
import { Sky } from '../render/scene';
import { useStore } from '../store/store';
import { Button, Txt } from '../ui/kit';
import { colors, motion, radius, skyForHour } from '../ui/theme';

const FONT_BLACK = require('@expo-google-fonts/nunito/900Black/Nunito_900Black.ttf');
const FONT_BOLD = require('@expo-google-fonts/nunito/800ExtraBold/Nunito_800ExtraBold.ttf');

/** A picture of the island with this week's numbers, ready to share. */
export function ShareCard({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { width: w, height: h } = useWindowDimensions();
  const game = useStore((s) => s.game);
  const now = useStore((s) => s.now);
  const notify = useStore((s) => s.notify);
  const ref = useCanvasRef();
  const [busy, setBusy] = useState(false);

  const cw = Math.min(w - 48, 360, (h - 260) / 1.25);
  const ch = cw * 1.25;
  const title = useFont(FONT_BLACK, cw * 0.1);
  const brand = useFont(FONT_BLACK, cw * 0.05);
  const small = useFont(FONT_BOLD, cw * 0.043);

  const t = now();
  const today = dayIndex(t);
  const monday = weekStart(today);
  const week = isoWeek(today);
  let minutes = 0;
  for (let d = monday; d <= today; d++) minutes += game.progress.days[dayKey(d)] ?? 0;
  const plants = Object.keys(game.world.tiles).length;
  const palette = useMemo(() => skyForHour(new Date(t).getHours()), [visible]);

  const clock = useSharedValue(4000);
  const vitality = useSharedValue(vitalityNow(game.world, t));
  useEffect(() => {
    if (visible) vitality.value = vitalityNow(game.world, now());
  }, [visible, game.world, now, vitality]);

  const layout = useMemo(() => layoutIsland(game.world.radius, cw / 2, ch * 0.5, cw * 0.92, ch * 0.5), [game.world.radius, cw, ch]);

  const pop = useSharedValue(0.9);
  useEffect(() => {
    if (visible) {
      pop.value = 0.9;
      pop.value = withSpring(1, motion.pop);
    }
  }, [visible, pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const ink = palette.dark ? '#FFFFFF' : colors.ink;
  const line = `${formatMinutes(minutes)} focused  ·  ${game.progress.streak} day streak  ·  ${plants} ${plants === 1 ? 'plant' : 'plants'}`;
  const lineX = small ? Math.max(cw * 0.06, (cw - small.measureText(line).width) / 2) : cw * 0.06;

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const image = await ref.current?.makeImageSnapshotAsync();
      if (!image) throw new Error('no image');
      if (Platform.OS === 'web' || !(await Sharing.isAvailableAsync())) {
        notify('info', 'Sharing is not available on this device.');
        return;
      }
      const file = new File(Paths.cache, `grove-week-${week}.png`);
      if (file.exists) file.delete();
      file.create();
      await file.write(image.encodeToBytes());
      haptic('success');
      playSound('coin');
      await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: 'Share your grove' });
    } catch {
      notify('warn', 'Could not create the picture. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Animated.View style={popStyle}>
          <Pressable onPress={() => {}} style={{ borderRadius: radius.lg, overflow: 'hidden' }}>
            <Canvas ref={ref} style={{ width: cw, height: ch }} testID="share-canvas">
              <Group clip={{ rect: { x: 0, y: 0, width: cw, height: ch }, rx: 0, ry: 0 }}>
                <Sky w={cw} h={ch} palette={palette} clock={clock} />
                <Island layout={layout} world={game.world} seeds={game.seeds} vitality={vitality} clock={clock} still />
                <SkText x={cw * 0.07} y={cw * 0.12} text="GROVE" font={brand} color={ink} opacity={0.7} />
                <SkText x={cw * 0.07} y={cw * 0.235} text={`Week ${week}`} font={title} color={ink} />
                <RoundedRect x={cw * 0.04} y={ch - cw * 0.17} width={cw * 0.92} height={cw * 0.11} r={cw * 0.055} color="rgba(255,255,255,0.9)" />
                <SkText x={lineX} y={ch - cw * 0.1} text={line} font={small} color={colors.ink} />
              </Group>
            </Canvas>
          </Pressable>
        </Animated.View>
        <View style={{ width: cw, marginTop: 18 }}>
          <Button label={busy ? 'Preparing...' : 'Share picture'} tone="gold" onPress={share} disabled={busy} testID="share-go" />
          <Button label="Close" tone="ghost" onPress={onClose} style={{ marginTop: 10, minHeight: 50 }} testID="share-close" feel="light" />
        </View>
        <Txt weight="bold" size={12.5} color="rgba(255,255,255,0.8)" center style={{ marginTop: 12 }}>
          The picture shows your island as it looks right now.
        </Txt>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 24, 17, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
