import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '../feel/haptics';
import { setUpNotifications } from '../feel/notify';
import { SEASONS } from '../game/atmosphere';
import { CONFIG } from '../game/config';
import { ANIMALS, TERRAIN_INFO, levelProgress } from '../game/nature';
import { BOND_LABELS, bondLevel, daysToNextBond, landmarkRebuildStreak, stumps } from '../game/stakes';
import { LANDMARK_KINDS } from '../game/types';
import { TIER_LABEL, VARIANTS } from '../game/variants';
import { VISITORS, visitorHere } from '../game/visitors';
import { IslandStatus } from '../ui/IslandStatus';
import { formatAgo, newsText, newsTone } from '../ui/stakesText';
import { RARITY_LABEL, SPECIES, getSpecies } from '../game/species';
import { ringProgress, streakAtRisk } from '../game/streak';
import { dayIndex, dayKey, formatMinutes, weekStart } from '../game/time';
import { PlantSheet } from '../render/PlantSprite';
import { hasAnimalSprite } from '../render/creatures';
import { grantText } from './IslandScreen';
import { useStore } from '../store/store';
import { RingRow } from '../ui/Ring';
import { Button, Card, CoinIcon, PressableScale, Toggle, Txt } from '../ui/kit';
import { colors, radius, rarityColor, rarityTint } from '../ui/theme';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const RING = 36;
const GAP = 10;

function Stat({ value, label, color = colors.ink }: { value: string; label: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Txt weight="black" size={22} color={color}>
        {value}
      </Txt>
      <Txt weight="bold" size={12} color={colors.inkFaint} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Txt weight="black" size={18} style={{ marginTop: 22, marginBottom: 10, marginLeft: 4 }}>
      {children}
    </Txt>
  );
}

export function JournalScreen({ onShare }: { onShare: () => void }) {
  const insets = useSafeAreaInsets();
  const { width: w } = useWindowDimensions();
  const game = useStore((s) => s.game);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const setGoal = useStore((s) => s.setGoal);
  const updateSettings = useStore((s) => s.updateSettings);
  const devAddCoins = useStore((s) => s.devAddCoins);
  const devAddFocus = useStore((s) => s.devAddFocus);
  const devSkipTime = useStore((s) => s.devSkipTime);
  const devAddStreak = useStore((s) => s.devAddStreak);
  const resetAll = useStore((s) => s.resetAll);
  const [confirmReset, setConfirmReset] = useState(false);

  const { progress, economy } = game;
  const today = dayIndex(now());
  const monday = weekStart(today);
  const week = useMemo(
    () =>
      WEEKDAYS.map((label, i) => {
        const index = monday + i;
        const key = dayKey(index);
        return {
          label,
          key,
          isToday: index === today,
          future: index > today,
          frozen: progress.frozenDays.includes(key),
          ring: ringProgress(progress, key),
          minutes: progress.days[key] ?? 0,
        };
      }),
    [monday, today, progress],
  );
  const weekMinutes = week.reduce((a, d) => a + d.minutes, 0);
  const discovered = SPECIES.filter((s) => progress.discovered[s.id]).length;
  const recent = useMemo(() => [...game.sessions].reverse().slice(0, 8), [game.sessions]);
  const atRisk = streakAtRisk(progress, today);
  const freezeFull = progress.freezes >= CONFIG.streak.maxFreezes;
  const cell = (w - 36 - 3 * GAP) / 4;
  const iconSize = cell * 0.62;
  const cellH = iconSize + 50;
  const weekW = w - 36 - 34;
  const ringCenters = useMemo(() => WEEKDAYS.map((_, i) => RING / 2 + (i * (weekW - RING)) / 6), [weekW]);
  const sheetItems = useMemo(
    () =>
      SPECIES.map((s, i) => ({
        speciesId: s.id,
        cx: (i % 4) * (cell + GAP) + cell / 2,
        top: Math.floor(i / 4) * (cellH + GAP) + 8,
        size: iconSize,
        silhouette: !progress.discovered[s.id],
      })),
    [cell, cellH, iconSize, progress.discovered],
  );
  const gridH = Math.ceil(SPECIES.length / 4) * (cellH + GAP) - GAP;

  // Wildlife: three wider cards per row, each with room for a hint.
  const wildCell = (w - 36 - 2 * GAP) / 3;
  const wildIcon = 46;
  const wildH = wildIcon + 84;
  const met = ANIMALS.filter((a) => game.nature.discovered[a.id] != null).length;
  const wildItems = useMemo(
    () =>
      ANIMALS.map((a, i) => ({ a, i }))
        .filter(({ a }) => hasAnimalSprite(a.id))
        .map(({ a, i }) => ({
          animal: a.id,
          cx: (i % 3) * (wildCell + GAP) + wildCell / 2,
          top: Math.floor(i / 3) * (wildH + GAP) + 8,
          size: wildIcon,
          silhouette: game.nature.discovered[a.id] == null,
        })),
    [wildCell, wildH, game.nature.discovered],
  );
  const wildGridH = Math.ceil(ANIMALS.length / 3) * (wildH + GAP) - GAP;
  const level = levelProgress(economy.lifetimeFocusMin);
  const SWARM_ICON: Record<string, string> = { butterfly: '🦋', bee: '🐝', firefly: '✨' };
  const nature = game.nature;
  const revival = nature.revival;
  const lostAnimals = Object.keys(nature.away).length;
  const lostPlants = useMemo(() => stumps(game).length, [game]);
  const diary = useMemo(() => [...nature.news].reverse().slice(0, 8), [nature.news]);
  const landmarkItems = LANDMARK_KINDS.map((k, i) => ({ terrain: k, cx: 26, top: i * 58 + 4, size: 44, silhouette: !nature.landmarks[k] }));

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.paper }]} testID="journal-screen">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <Txt weight="black" size={30}>
          Journal
        </Txt>

        <IslandStatus style={{ marginTop: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardEdge }} />

        {(revival || lostAnimals > 0 || lostPlants > 0) && (
          <Card style={{ marginTop: 12, backgroundColor: '#FFF3E0' }}>
            <Txt weight="black" size={16} testID="revival-title">
              {revival ? `Revival · day ${revival.days} of ${CONFIG.stakes.revivalDays}` : 'Your island has lost something'}
            </Txt>
            <Txt weight="bold" size={13} color={colors.inkSoft} style={{ marginTop: 4 }}>
              {[
                lostAnimals > 0 ? `${lostAnimals} ${lostAnimals === 1 ? 'animal has' : 'animals have'} moved away` : null,
                lostPlants > 0 ? `${lostPlants} ${lostPlants === 1 ? 'plant has' : 'plants have'} died` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Txt>
            {revival && (
              <View style={[styles.meter, { backgroundColor: '#FBE3C4' }]}>
                <View style={[styles.meterFill, { backgroundColor: '#E08A2B', width: `${(revival.days / CONFIG.stakes.revivalDays) * 100}%` }]} />
              </View>
            )}
            <Txt weight="bold" size={12.5} color={colors.inkSoft} style={{ marginTop: 8 }}>
              {revival
                ? `Focus ${CONFIG.streak.minQualifyingMin}+ minutes on ${CONFIG.stakes.revivalDays - revival.days} more ${CONFIG.stakes.revivalDays - revival.days === 1 ? 'day' : 'days'} and half of what you lost comes back at once.`
                : `Every session of ${CONFIG.streak.minQualifyingMin}+ minutes revives one plant. Animals return after ${CONFIG.stakes.returnDays} days of focus. Your next session starts a revival that brings half of them back in ${CONFIG.stakes.revivalDays} days.`}
            </Txt>
          </Card>
        )}

        <Animated.View entering={FadeInDown.duration(350)}>
          <Card style={{ marginTop: 14 }}>
            <View style={styles.rowBetween}>
              <Txt weight="black" size={16}>
                This week
              </Txt>
              <Txt weight="heavy" size={14} color={colors.inkSoft}>
                {formatMinutes(weekMinutes)} focused
              </Txt>
            </View>
            <View style={{ marginTop: 14 }}>
              <RingRow width={weekW} size={RING} centers={ringCenters} values={week.map((d) => (d.future ? 0 : d.ring))} />
              <View style={[StyleSheet.absoluteFill, styles.rowBetween]}>
                {week.map((d, i) => (
                  <View key={i} style={[styles.center, { width: RING, height: RING }]}>
                    {d.frozen && <Txt size={13}>❄️</Txt>}
                  </View>
                ))}
              </View>
            </View>
            <View style={[styles.rowBetween, { marginTop: 6 }]}>
              {week.map((d, i) => (
                <View key={i} style={{ width: RING, alignItems: 'center', opacity: d.future ? 0.4 : 1 }}>
                  <View style={[styles.dayLabel, d.isToday && { backgroundColor: colors.ink }]}>
                    <Txt weight="black" size={11.5} color={d.isToday ? colors.white : colors.inkFaint}>
                      {d.label}
                    </Txt>
                  </View>
                </View>
              ))}
            </View>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(60).duration(350)}>
          <Card style={{ marginTop: 12 }}>
            <View style={styles.rowBetween}>
              <Stat value={`${progress.streak}`} label={atRisk ? 'streak at risk' : 'day streak'} color={atRisk ? '#C2531A' : colors.ink} />
              <Stat value={`${progress.bestStreak}`} label="best streak" />
              <Stat value={formatMinutes(economy.lifetimeFocusMin)} label="total focus" />
              <Stat value={`${economy.lifetimeSessions}`} label="sessions" />
            </View>
            <View style={styles.divider} />
            <View style={styles.rowBetween}>
              <Txt weight="heavy" size={14}>
                {`❄️ Streak freezes  ${progress.freezes} / ${CONFIG.streak.maxFreezes}`}
              </Txt>
              <Txt weight="bold" size={12.5} color={colors.inkFaint}>
                {freezeFull
                  ? 'pocket full'
                  : `${Math.ceil(CONFIG.streak.minutesPerFreeze - progress.minutesTowardFreeze)} min to the next`}
              </Txt>
            </View>
            <View style={styles.meter}>
              <View
                style={[
                  styles.meterFill,
                  { width: `${freezeFull ? 100 : (progress.minutesTowardFreeze / CONFIG.streak.minutesPerFreeze) * 100}%` },
                ]}
              />
            </View>
            <Txt weight="bold" size={12} color={colors.inkFaint} style={{ marginTop: 6 }}>
              Freezes are earned by focusing and cover a missed day automatically.
            </Txt>
          </Card>
        </Animated.View>

        <Card style={{ marginTop: 12 }}>
          <View style={styles.rowBetween}>
            <View>
              <Txt weight="black" size={16}>
                Daily goal
              </Txt>
              <Txt weight="bold" size={12.5} color={colors.inkFaint}>
                Closes your ring
              </Txt>
            </View>
            <View style={styles.row}>
              <PressableScale
                feel="tick"
                style={styles.stepBtn}
                onPress={() => setGoal(progress.dailyGoalMin - CONFIG.ring.goalStepMin)}
                disabled={progress.dailyGoalMin <= CONFIG.ring.minGoalMin}
                testID="goal-minus"
                accessibilityLabel="Lower daily goal"
              >
                <Txt weight="black" size={20}>
                  −
                </Txt>
              </PressableScale>
              <Txt weight="black" size={18} center style={{ width: 76 }} testID="goal-value">
                {formatMinutes(progress.dailyGoalMin)}
              </Txt>
              <PressableScale
                feel="tick"
                style={styles.stepBtn}
                onPress={() => setGoal(progress.dailyGoalMin + CONFIG.ring.goalStepMin)}
                disabled={progress.dailyGoalMin >= CONFIG.ring.maxGoalMin}
                testID="goal-plus"
                accessibilityLabel="Raise daily goal"
              >
                <Txt weight="black" size={20}>
                  +
                </Txt>
              </PressableScale>
            </View>
          </View>
        </Card>

        <Button label="Share this week's island" tone="gold" onPress={onShare} style={{ marginTop: 14 }} testID="journal-share" />

        <SectionTitle>{`Collection  ${discovered} / ${SPECIES.length}`}</SectionTitle>
        <View style={styles.grid}>
          {SPECIES.map((s) => {
            const count = progress.discovered[s.id] ?? 0;
            const found = count > 0;
            return (
              <View
                key={s.id}
                style={[
                  styles.cell,
                  { width: cell, height: cellH, backgroundColor: found ? rarityTint[s.rarity] : '#F1ECE0', borderColor: found ? rarityColor[s.rarity] : 'transparent' },
                ]}
              >
                <View style={{ height: iconSize }} />
                <Txt weight="heavy" size={11.5} center numberOfLines={1} style={{ marginTop: 2 }} color={found ? colors.ink : colors.inkFaint}>
                  {found ? s.name : '???'}
                </Txt>
                <Txt weight="bold" size={10.5} color={found ? rarityColor[s.rarity] : colors.inkFaint}>
                  {found ? `${RARITY_LABEL[s.rarity]}${count > 1 ? ` · ${count}` : ''}` : RARITY_LABEL[s.rarity]}
                </Txt>
              </View>
            );
          })}
          <PlantSheet width={w - 36} height={gridH} items={sheetItems} style={{ position: 'absolute', left: 0, top: 0 }} />
        </View>

        <SectionTitle>{`Wildlife  ${met} / ${ANIMALS.length}`}</SectionTitle>
        <Card style={{ marginBottom: 10, paddingVertical: 12 }}>
          <View style={styles.rowBetween}>
            <Txt weight="black" size={15} testID="journal-level">
              {`Island level ${level.level}`}
            </Txt>
            <Txt weight="bold" size={12.5} color={colors.inkFaint}>
              {`${formatMinutes(level.minutesToNext)} to ${grantText(level.nextGrants)}`}
            </Txt>
          </View>
          <View style={[styles.meter, { backgroundColor: '#FBF0D6' }]}>
            <View style={[styles.meterFill, { backgroundColor: colors.coin, width: `${Math.min(1, level.fraction) * 100}%` }]} />
          </View>
          <Txt weight="bold" size={12} color={colors.inkFaint} style={{ marginTop: 6 }}>
            Focus raises your island level. Each level brings water, rocks and more to place, and animals move in when the island suits them.
          </Txt>
        </Card>
        <View style={styles.grid}>
          {ANIMALS.map((a) => {
            const found = game.nature.discovered[a.id] != null;
            const away = nature.away[a.id];
            const bond = nature.bonds[a.id];
            const lvl = bondLevel(bond?.points ?? 0);
            const toNext = daysToNextBond(bond?.points ?? 0);
            const title = !found ? '???' : bond?.name ? `${bond.name}` : a.name;
            const detail = !found
              ? a.hint
              : away
                ? `Moved away. ${CONFIG.stakes.returnDays - away.days} focus days to return`
                : lvl > 0
                  ? `${BOND_LABELS[lvl]}${nature.family[a.id] != null ? ' · family' : ''}${toNext > 0 ? ` · ${toNext}d to ${BOND_LABELS[lvl + 1].toLowerCase()}` : ''}`
                  : a.nocturnal
                    ? 'Comes out at night'
                    : a.blurb;
            return (
              <View
                key={a.id}
                style={[
                  styles.cell,
                  {
                    width: wildCell,
                    height: wildH,
                    backgroundColor: away ? '#F7E4DC' : found ? '#EAF6EC' : '#F1ECE0',
                    borderColor: away ? '#D98A6C' : found ? (lvl >= 2 ? colors.coin : colors.leaf) : 'transparent',
                  },
                ]}
                testID={`wild-${a.id}`}
              >
                <View style={[styles.center, { height: wildIcon, opacity: away ? 0.35 : 1 }]}>
                  {!hasAnimalSprite(a.id) && <Txt size={26} style={{ opacity: found ? 1 : 0.25 }}>{SWARM_ICON[a.id] ?? '🐾'}</Txt>}
                </View>
                <Txt weight="heavy" size={12.5} center numberOfLines={1} style={{ marginTop: 3 }} color={found ? colors.ink : colors.inkFaint}>
                  {title}
                </Txt>
                {found && lvl > 0 && !away && (
                  <Txt size={9} center style={{ marginTop: 1 }} testID={`bond-${a.id}`}>
                    {'💛'.repeat(lvl)}
                  </Txt>
                )}
                <Txt weight="bold" size={10.5} center numberOfLines={2} color={away ? '#A4512F' : found ? colors.inkSoft : colors.inkFaint} style={{ marginTop: 1 }}>
                  {detail}
                </Txt>
              </View>
            );
          })}
          <PlantSheet width={w - 36} height={wildGridH} items={wildItems} style={{ position: 'absolute', left: 0, top: 0 }} />
        </View>

        <SectionTitle>{`Visitors  ${VISITORS.filter((v) => nature.visitors[v.id]).length} / ${VISITORS.length}`}</SectionTitle>
        <Txt weight="bold" size={12.5} color={colors.inkSoft} style={{ marginBottom: 8 }}>
          Every day a traveller passes by. It lands only if you focus 10+ minutes that day, and it is gone by morning.
        </Txt>
        <View style={styles.grid}>
          {VISITORS.map((v) => {
            const met = nature.visitors[v.id] ?? 0;
            const here = visitorHere(game, now()) === v.id;
            return (
              <View
                key={v.id}
                style={[styles.cell, { width: wildCell, height: wildH, backgroundColor: here ? '#FFF3D6' : met ? '#EAF6EC' : '#F1ECE0', borderColor: here ? colors.coin : met ? colors.leaf : 'transparent' }]}
                testID={`visitor-${v.id}`}
              >
                <View style={{ height: wildIcon }} />
                <Txt weight="heavy" size={12.5} center numberOfLines={1} style={{ marginTop: 3 }} color={met ? colors.ink : colors.inkFaint}>
                  {met ? v.name : '???'}
                </Txt>
                <Txt weight="bold" size={10.5} center numberOfLines={3} color={met ? colors.inkSoft : colors.inkFaint} style={{ marginTop: 1 }}>
                  {here ? 'Here today' : met ? `Met ${met === 1 ? 'once' : `${met} times`}` : v.hint}
                </Txt>
              </View>
            );
          })}
          <PlantSheet
            width={w - 36}
            height={Math.ceil(VISITORS.length / 3) * (wildH + GAP) - GAP}
            items={VISITORS.map((v, i) => ({
              animal: v.id,
              cx: (i % 3) * (wildCell + GAP) + wildCell / 2,
              top: Math.floor(i / 3) * (wildH + GAP) + 8,
              size: wildIcon,
              silhouette: !nature.visitors[v.id],
            }))}
            style={{ position: 'absolute', left: 0, top: 0 }}
          />
        </View>

        <SectionTitle>{`Variants  ${VARIANTS.filter((v) => progress.variants[v.id]).length} / ${VARIANTS.length}`}</SectionTitle>
        <Card style={{ paddingVertical: 6 }}>
          <Txt weight="bold" size={12.5} color={colors.inkSoft} style={{ paddingVertical: 6 }}>
            Now and then a seed grows into a plant with a quirk. It looks like any other from afar: the detail below is how you tell. Variants hold out longer in a drought.
          </Txt>
          {[...VARIANTS].reverse().map((v) => {
            const n = progress.variants[v.id] ?? 0;
            return (
              <View key={v.id} style={{ paddingVertical: 7 }} testID={`variant-${v.id}`}>
                <View style={styles.rowBetween}>
                  <Txt weight="heavy" size={14} color={n ? colors.ink : colors.inkFaint}>
                    {n ? v.name : '???'}
                  </Txt>
                  <Txt weight="heavy" size={11.5} color={n ? colors.coinDark : colors.inkFaint}>
                    {`${TIER_LABEL[v.tier]}${n ? ` · found ${n}` : ''}`}
                  </Txt>
                </View>
                <Txt weight="bold" size={12} color={n ? colors.inkSoft : colors.inkFaint}>
                  {n ? v.tell : 'Not found yet'}
                </Txt>
              </View>
            );
          })}
        </Card>

        <SectionTitle>Streak landmarks</SectionTitle>
        <Card style={{ paddingVertical: 8 }}>
          {LANDMARK_KINDS.map((k) => {
            const mark = nature.landmarks[k];
            const need = CONFIG.stakes.landmarkStreaks[k];
            const status = !mark
              ? `Built by a ${need}-day streak · ${Math.max(1, need - progress.streak)} to go`
              : mark.ruined
                ? `In ruins. Rebuilt at a ${landmarkRebuildStreak(k)}-day streak`
                : 'Standing. It falls to ruins if your streak breaks';
            return (
              <View key={k} style={{ height: 58, paddingLeft: 60, justifyContent: 'center' }} testID={`landmark-${k}`}>
                <Txt weight="heavy" size={14.5} color={mark ? colors.ink : colors.inkFaint}>
                  {TERRAIN_INFO[k].name}
                </Txt>
                <Txt weight="bold" size={12} color={mark?.ruined ? '#A4512F' : colors.inkSoft}>
                  {status}
                </Txt>
              </View>
            );
          })}
          <PlantSheet width={56} height={LANDMARK_KINDS.length * 58} items={landmarkItems} style={{ position: 'absolute', left: 12, top: 8 }} />
        </Card>

        <SectionTitle>Island diary</SectionTitle>
        <Card style={{ paddingVertical: 6 }}>
          {diary.length === 0 ? (
            <Txt weight="bold" size={14} color={colors.inkFaint} style={{ paddingVertical: 12 }}>
              Arrivals, friendships and losses are written down here.
            </Txt>
          ) : (
            diary.map((n, i) => {
              const tone = newsTone(n);
              return (
                <View key={`${n.at}:${n.kind}:${n.subject}:${i}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }} testID="diary-row">
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      marginRight: 10,
                      backgroundColor: tone === 'bad' ? '#C2531A' : tone === 'good' ? colors.leaf : colors.coin,
                    }}
                  />
                  <Txt weight="heavy" size={13.5} style={{ flex: 1 }} numberOfLines={2}>
                    {newsText(n)}
                  </Txt>
                  <Txt weight="bold" size={11.5} color={colors.inkFaint} style={{ marginLeft: 8 }}>
                    {formatAgo(n.at, now())}
                  </Txt>
                </View>
              );
            })
          )}
        </Card>

        <SectionTitle>Recent sessions</SectionTitle>
        <Card style={{ paddingVertical: 6 }}>
          {recent.length === 0 ? (
            <Txt weight="bold" size={14} color={colors.inkFaint} style={{ paddingVertical: 12 }}>
              Your sessions will show up here.
            </Txt>
          ) : (
            recent.map((s, i) => {
              const seed = s.seedId ? game.seeds[s.seedId] : null;
              const done = s.outcome === 'completed';
              const when = new Date(s.endedAt - settings.timeOffsetMs);
              return (
                <View key={s.id} style={[styles.session, i > 0 && styles.sessionBorder]}>
                  <View style={[styles.sessionDot, { backgroundColor: done ? colors.leaf : '#C9BFAA' }]} />
                  <View style={{ flex: 1 }}>
                    <Txt weight="heavy" size={14.5}>
                      {done
                        ? `${s.durationSec < 60 ? `${s.durationSec}s` : formatMinutes(s.durationSec / 60)} · ${seed ? getSpecies(seed.speciesId).name : 'seed'}`
                        : `${formatMinutes(s.durationSec / 60)} · withered`}
                    </Txt>
                    <Txt weight="bold" size={12} color={colors.inkFaint}>
                      {`${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}
                    </Txt>
                  </View>
                  {(done ? s.coinsEarned + s.payout - s.stake : -s.stake) !== 0 && (
                    <View style={styles.row}>
                      <Txt weight="black" size={14} color={done ? colors.coinDark : colors.danger} style={{ marginRight: 5 }}>
                        {done ? `+${s.coinsEarned + s.payout - s.stake}` : `−${s.stake}`}
                      </Txt>
                      <CoinIcon size={14} />
                    </View>
                  )}
                </View>
              );
            })
          )}
        </Card>

        <SectionTitle>Settings</SectionTitle>
        <Card style={{ paddingVertical: 6 }}>
          <Toggle label="Sound" value={settings.sound} onChange={(v) => updateSettings({ sound: v })} />
          <Toggle label="Haptics" value={settings.haptics} onChange={(v) => updateSettings({ haptics: v })} />
          <Toggle
            label="Reminders"
            value={settings.notifications}
            onChange={(v) => {
              updateSettings({ notifications: v });
              if (v) void setUpNotifications();
            }}
          />
          <Toggle label="Island sounds while focusing" value={settings.focusAmbience} onChange={(v) => updateSettings({ focusAmbience: v })} />
          <Toggle label="Southern hemisphere seasons" value={settings.south} onChange={(v) => updateSettings({ south: v })} />
          <Toggle label="Developer tools" value={settings.devTools} onChange={(v) => updateSettings({ devTools: v })} />
        </Card>

        {settings.devTools && (
          <Card style={{ marginTop: 12, backgroundColor: '#FFF8E7' }}>
            <Txt weight="black" size={15}>
              Developer tools
            </Txt>
            <Txt weight="bold" size={12.5} color={colors.inkSoft} style={{ marginTop: 4 }}>
              {`A 10 second test session is now on the duration dial. Clock offset: ${Math.round(settings.timeOffsetMs / 3_600_000)}h.`}
            </Txt>
            <View style={styles.devRow}>
              <Button label="+12 hours" tone="ghost" onPress={() => devSkipTime(12)} style={styles.devBtn} testID="dev-skip-12" feel="light" />
              <Button label="+1 day" tone="ghost" onPress={() => devSkipTime(24)} style={styles.devBtn} testID="dev-skip-24" feel="light" />
            </View>
            <View style={styles.devRow}>
              <Button label="+100 coins" tone="ghost" onPress={() => devAddCoins(100)} style={styles.devBtn} testID="dev-coins" feel="light" />
              <Button label="+2h focus" tone="ghost" onPress={() => devAddFocus(120)} style={styles.devBtn} testID="dev-focus" feel="light" />
            </View>
            <View style={styles.devRow}>
              <Button
                label={`Season: ${settings.seasonOverride ?? 'calendar'}`}
                tone="ghost"
                onPress={() => {
                  const order = [null, ...SEASONS];
                  updateSettings({ seasonOverride: order[(order.indexOf(settings.seasonOverride) + 1) % order.length] });
                }}
                style={styles.devBtn}
                testID="dev-season"
                feel="light"
              />
              <Button
                label={`Weather: ${settings.weatherOverride ?? 'real'}`}
                tone="ghost"
                onPress={() => {
                  const order = [null, 'clear', 'rain', 'rainbow', 'snow', 'haze', 'fog'] as const;
                  updateSettings({ weatherOverride: order[(order.indexOf(settings.weatherOverride) + 1) % order.length] });
                }}
                style={styles.devBtn}
                testID="dev-weather"
                feel="light"
              />
            </View>
            <View style={styles.devRow}>
              <Button label="+7 streak days" tone="ghost" onPress={() => devAddStreak(7)} style={styles.devBtn} testID="dev-streak" feel="light" />
              <Button label="+3 days" tone="ghost" onPress={() => devSkipTime(72)} style={styles.devBtn} testID="dev-skip-72" feel="light" />
            </View>
            <View style={styles.devRow}>
              <Button
                label={confirmReset ? 'Really erase?' : 'Erase all data'}
                tone={confirmReset ? 'danger' : 'ghost'}
                onPress={() => {
                  if (!confirmReset) {
                    setConfirmReset(true);
                    return;
                  }
                  haptic('heavy');
                  setConfirmReset(false);
                  resetAll();
                }}
                style={styles.devBtn}
                testID="dev-reset"
                feel="light"
              />
            </View>
          </Card>
        )}

        <Txt weight="bold" size={12} color={colors.inkFaint} center style={{ marginTop: 22 }}>
          Grove 1.0 · everything stays on this phone
        </Txt>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  center: { alignItems: 'center', justifyContent: 'center' },
  stat: { alignItems: 'center', flex: 1 },
  divider: { height: 1, backgroundColor: colors.cardEdge, marginVertical: 14 },
  dayLabel: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  meter: { height: 8, borderRadius: 4, backgroundColor: '#E6F3FA', marginTop: 10, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4, backgroundColor: colors.ice },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.cardEdge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  cell: { borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', borderWidth: 2 },
  session: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  sessionBorder: { borderTopWidth: 1, borderTopColor: '#F1EADB' },
  sessionDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  devRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  devBtn: { flex: 1, minHeight: 46, paddingHorizontal: 8, borderBottomWidth: 3 },
});
