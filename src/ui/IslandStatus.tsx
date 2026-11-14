import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { moodOf, vitalityNow, type VitalityMood } from '../game/decay';
import { threats, type Threat } from '../game/stakes';
import { getVisitor, visitorHere, visitorWaiting } from '../game/visitors';
import { useStore } from '../store/store';
import { Txt } from './kit';
import { threatLevel, threatText } from './stakesText';
import { colors, radius } from './theme';

export const MOOD_COLOR: Record<VitalityMood, string> = {
  thriving: colors.leaf,
  thirsty: '#C9A227',
  wilting: '#C2783A',
  dormant: '#9A8F7A',
};

const LEVEL_COLOR = { calm: colors.inkSoft, soon: '#B26A12', urgent: '#C2381A' } as const;

/** The island's health and what is about to happen to it, recomputed every half minute. */
export function useIslandStatus(): { vitality: number; next: Threat[]; now: number } {
  const game = useStore((s) => s.game);
  const clock = useStore((s) => s.now);
  const offset = useStore((s) => s.settings.timeOffsetMs);
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setBeat((b) => b + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => {
    const now = clock();
    return { vitality: vitalityNow(game.world, now), next: threats(game, now), now };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, clock, offset, beat]);
}

/**
 * The leaf meter that sits in the header of every screen: how alive the
 * island is, and the next thing that goes wrong if nobody focuses.
 */
export function IslandStatus({ style, compact = false }: { style?: StyleProp<ViewStyle>; compact?: boolean }) {
  const { vitality, next, now } = useIslandStatus();
  const hasIsland = useStore((s) => s.game.world.graceUntil != null);
  if (!hasIsland) return null;
  const color = MOOD_COLOR[moodOf(vitality)];
  const threat = next[0];
  const game = useStore((s) => s.game);
  const waiting = getVisitor(visitorWaiting(game, now));
  const here = getVisitor(visitorHere(game, now));
  const level = threat ? threatLevel(threat, now) : 'calm';
  return (
    <View style={[styles.card, style]} testID="island-status" accessibilityLabel={`Island health ${Math.round(vitality * 100)} percent`}>
      <View style={styles.row}>
        <Txt size={13}>🍃</Txt>
        <View style={styles.bar}>
          <View style={[styles.fill, { width: `${Math.max(4, vitality * 100)}%`, backgroundColor: color }]} />
        </View>
        <Txt weight="black" size={12.5} style={{ width: 38, textAlign: 'right' }} testID="island-health">
          {`${Math.round(vitality * 100)}%`}
        </Txt>
      </View>
      {threat && (
        <View style={[styles.row, { marginTop: 5 }]}>
          <View style={[styles.dot, { backgroundColor: LEVEL_COLOR[level] }]} />
          <Txt weight="heavy" size={12.5} color={LEVEL_COLOR[level]} numberOfLines={1} style={{ flex: 1 }} testID="next-threat">
            {threatText(threat, now)}
          </Txt>
        </View>
      )}
      {(waiting || here) && (
        <View style={[styles.row, { marginTop: 5 }]}>
          <Txt size={11} style={{ width: 18 }}>
            🧳
          </Txt>
          <Txt weight="heavy" size={12.5} color={here ? colors.leafDark : colors.inkSoft} numberOfLines={1} style={{ flex: 1 }} testID="visitor-line">
            {here
              ? `The ${here.name} is visiting today`
              : game.nature.visitors[waiting!.id]
                ? `The ${waiting!.name} is passing by: focus 10 min and it lands`
                : 'A stranger is passing by: focus 10 min to meet it'}
          </Txt>
        </View>
      )}
      {!compact &&
        next.slice(1, 3).map((t) => (
          <View key={`${t.kind}:${t.animalId ?? ''}`} style={[styles.row, { marginTop: 3 }]}>
            <View style={[styles.dot, { backgroundColor: 'rgba(31,61,43,0.25)' }]} />
            <Txt weight="bold" size={12} color={colors.inkSoft} numberOfLines={1} style={{ flex: 1 }}>
              {threatText(t, now)}
            </Txt>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  bar: { flex: 1, height: 7, borderRadius: 4, backgroundColor: 'rgba(31,61,43,0.1)', marginHorizontal: 8, overflow: 'hidden' },
  fill: { height: 7, borderRadius: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 8, marginLeft: 3 },
});
