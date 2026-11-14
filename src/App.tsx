import { Nunito_600SemiBold } from '@expo-google-fonts/nunito/600SemiBold';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { Nunito_900Black } from '@expo-google-fonts/nunito/900Black';
import { useFonts } from 'expo-font';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { AppState, BackHandler, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInUp,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from './feel/haptics';
import { clearLeaveWarning, scheduleWiltReminders, setUpNotifications, warnAboutLeaving } from './feel/notify';
import { playSound, warmUpSounds } from './feel/sound';
import { gracesLeft } from './game/engine';
import { unplantedSeeds } from './game/world';
import { FocusScreen } from './screens/FocusScreen';
import { IslandScreen } from './screens/IslandScreen';
import { JournalScreen } from './screens/JournalScreen';
import { ShareCard } from './screens/ShareCard';
import { useStore } from './store/store';
import { PressableScale, Txt } from './ui/kit';
import { colors, motion, radius, skyAt } from './ui/theme';
import { hourAt } from './game/atmosphere';

type Tab = 'focus' | 'island' | 'journal';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'focus', label: 'Focus', icon: '🌱' },
  { id: 'island', label: 'Island', icon: '🏝️' },
  { id: 'journal', label: 'Journal', icon: '📖' },
];

/**
 * Everything that connects a session to the outside world: leaving and
 * returning to the app, the clock, and keeping the screen awake.
 */
function useSessionLifecycle() {
  const activeId = useStore((s) => s.game.active?.id);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const store = useStore.getState();
      if (state === 'background') {
        // Persist "left at" right away: the process may be killed at any time from here on.
        store.background();
        const active = useStore.getState().game.active;
        if (active) void warnAboutLeaving(gracesLeft(active));
        void scheduleWiltReminders();
      } else if (state === 'active') {
        void clearLeaveWarning();
        store.foreground();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const id = setInterval(() => useStore.getState().tick(), 250);
    return () => clearInterval(id);
  }, [activeId]);

  useEffect(() => {
    if (activeId) activateKeepAwakeAsync('grove-session').catch(() => {});
    else deactivateKeepAwake('grove-session').catch(() => {});
  }, [activeId]);
}

function Toast() {
  const notice = useStore((s) => s.notice);
  const clear = useStore((s) => s.clearNotice);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(clear, 3600);
    return () => clearTimeout(id);
  }, [notice, clear]);
  if (!notice) return null;
  const bg = notice.tone === 'warn' ? '#C2531A' : notice.tone === 'good' ? colors.leafDark : colors.ink;
  return (
    <Animated.View
      key={notice.id}
      entering={FadeInUp.springify().damping(13)}
      exiting={FadeOutUp.duration(250)}
      style={[styles.toast, { top: insets.top + 12, backgroundColor: bg }]}
      pointerEvents="none"
      testID="toast"
    >
      <Txt weight="heavy" size={14} color={colors.white} center>
        {notice.text}
      </Txt>
    </Animated.View>
  );
}

function TabBar({ tab, onChange, hidden, seedsWaiting }: { tab: Tab; onChange: (t: Tab) => void; hidden: boolean; seedsWaiting: number }) {
  const insets = useSafeAreaInsets();
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = hidden
      ? withTiming(140, { duration: 260, easing: Easing.in(Easing.cubic) })
      : withSpring(0, motion.settle);
  }, [hidden, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View style={[styles.tabBar, { bottom: insets.bottom + 14 }, style]} pointerEvents={hidden ? 'none' : 'auto'}>
      {TABS.map((t) => {
        const on = t.id === tab;
        return (
          <PressableScale
            key={t.id}
            feel="tick"
            onPress={() => onChange(t.id)}
            style={[styles.tab, on && styles.tabOn]}
            testID={`tab-${t.id}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
          >
            <Txt size={19}>{t.icon}</Txt>
            <Txt weight="black" size={12} color={on ? colors.ink : colors.inkFaint} style={{ marginTop: 1 }}>
              {t.label}
            </Txt>
            {t.id === 'island' && seedsWaiting > 0 && (
              <View style={styles.tabBadge}>
                <Txt weight="black" size={11} color={colors.white}>
                  {seedsWaiting}
                </Txt>
              </View>
            )}
          </PressableScale>
        );
      })}
    </Animated.View>
  );
}

function Root() {
  const [tab, setTab] = useState<Tab>('focus');
  const [preselect, setPreselect] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const active = useStore((s) => s.game.active);
  const result = useStore((s) => s.result);
  const immersive = useStore((s) => s.immersive);
  const seedsWaiting = useStore((s) => unplantedSeeds(s.game).length);

  useSessionLifecycle();

  useEffect(() => {
    warmUpSounds();
    const id = setTimeout(() => void setUpNotifications(), 1500);
    const s = useStore.getState();
    if (!s.settings.onboarded) {
      s.updateSettings({ onboarded: true });
      s.notify('good', 'Pick a duration, press start, and stay here while your sapling grows.');
    }
    return () => clearTimeout(id);
  }, []);

  // Asking for the notification permission is skipped during a session, so try again afterwards.
  useEffect(() => {
    if (!active) void setUpNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!active]);

  // A running session or its result always owns the screen.
  const now = useStore((s) => s.now);
  const night = skyAt(hourAt(now())).dark;
  const inSession = !!active || !!result;
  const shown: Tab = inSession ? 'focus' : tab;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = useStore.getState();
      if (s.game.active) {
        haptic('soft');
        s.notify('info', 'Hold "Give up" to end the session.');
        return true;
      }
      if (s.result || s.immersive) return true;
      if (tab !== 'focus') {
        setTab('focus');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [tab]);

  const changeTab = (t: Tab) => {
    if (t === tab) return;
    playSound('tick', 0.6);
    setPreselect(null);
    setTab(t);
  };

  return (
    <View style={styles.root}>
      <StatusBar style={shown !== 'journal' && night ? 'light' : 'dark'} />
      <Animated.View key={shown} entering={FadeIn.duration(240)} style={StyleSheet.absoluteFill}>
        {shown === 'focus' && (
          <FocusScreen
            onPlant={(seedId) => {
              setPreselect(seedId);
              setTab('island');
            }}
          />
        )}
        {shown === 'island' && <IslandScreen preselectSeedId={preselect} onShare={() => setSharing(true)} />}
        {shown === 'journal' && <JournalScreen onShare={() => setSharing(true)} />}
      </Animated.View>
      <TabBar tab={shown} onChange={changeTab} hidden={inSession || immersive} seedsWaiting={seedsWaiting} />
      <Toast />
      <ShareCard visible={sharing} onClose={() => setSharing(false)} />
    </View>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_900Black,
  });
  const hydrated = useStore((s) => s.hydrated);
  const hydrate = useStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if ((!fontsLoaded && !fontError) || !hydrated) return <View style={styles.root} />;
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#8FD0F5' },
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.md,
  },
  tabBar: {
    position: 'absolute',
    left: 18,
    right: 18,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'rgba(255,255,255,0.95)',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
    borderWidth: 1,
    borderColor: colors.cardEdge,
  },
  tab: { flex: 1, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#E4F5E6' },
  tabBadge: {
    position: 'absolute',
    top: 4,
    right: '22%',
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.flame,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
