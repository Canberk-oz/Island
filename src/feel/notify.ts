import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { CONFIG, HOUR_MS } from '../game/config';
import { callName, threats } from '../game/stakes';
import { useStore } from '../store/store';

type NotificationsModule = typeof import('expo-notifications');

const CHANNEL = 'grove';
const LEAVE_ID = 'grove-leave';
const WILT_IDS = ['grove-wilt-1', 'grove-wilt-2', 'grove-leaving', 'grove-left', 'grove-stump', 'grove-streak'];

let mod: NotificationsModule | null | undefined;
let ready = false;

/**
 * Notifications are optional polish. They are skipped on web and inside
 * Expo Go (which no longer ships full notification support on Android), and
 * every call is guarded so a failure can never affect a session.
 */
function notifications(): NotificationsModule | null {
  if (mod !== undefined) return mod;
  mod = null;
  if (Platform.OS === 'web') return mod;
  if (Constants.executionEnvironment === 'storeClient') return mod;
  try {
    mod = require('expo-notifications') as NotificationsModule;
  } catch {
    mod = null;
  }
  return mod;
}

function enabled() {
  return useStore.getState().settings.notifications;
}

/** Ask for permission and create the channel. Safe to call more than once. */
export async function setUpNotifications(): Promise<boolean> {
  const N = notifications();
  if (!N || !enabled()) return false;
  try {
    N.setNotificationHandler({
      // The "come back" warning is posted the instant the app leaves the
      // screen, when the system may still count it as being in front, so
      // notifications must be allowed to show in that state too.
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    await N.setNotificationChannelAsync(CHANNEL, {
      name: 'Grove',
      importance: N.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 120, 180],
    });
    let status = (await N.getPermissionsAsync()).status;
    // The system permission dialog pauses the app, which would count as
    // leaving it: never ask while a session is running.
    if (status !== 'granted' && !useStore.getState().game.active) {
      status = (await N.requestPermissionsAsync()).status;
    }
    ready = status === 'granted';
  } catch {
    ready = false;
  }
  return ready;
}

/** The app just went to the background during a session: call the player back. */
export async function warnAboutLeaving(gracesLeft: number) {
  const N = notifications();
  if (!N || !ready || !enabled()) return;
  const seconds = Math.round(CONFIG.session.graceMs / 1000);
  try {
    await N.scheduleNotificationAsync({
      identifier: LEAVE_ID,
      content: {
        title: 'Your sapling is wilting',
        body:
          gracesLeft > 0
            ? `Come back within ${seconds} seconds to save it.`
            : 'You are out of second chances for this session.',
      },
      trigger: { channelId: CHANNEL },
    });
  } catch {
    // ignore
  }
}

export async function clearLeaveWarning() {
  const N = notifications();
  if (!N || !ready) return;
  try {
    await N.dismissNotificationAsync(LEAVE_ID);
    await N.cancelScheduledNotificationAsync(LEAVE_ID);
  } catch {
    // ignore
  }
}

/**
 * Schedule what the island has to say while the app is closed: when it starts
 * to fade, which animal is getting restless, who is about to leave and who
 * left. Called whenever the app goes to the background, so the schedule
 * always reflects the latest focus.
 */
export async function scheduleWiltReminders() {
  const N = notifications();
  if (!N || !ready) return;
  try {
    for (const id of WILT_IDS) await N.cancelScheduledNotificationAsync(id);
    if (!enabled()) return;
    const { game, now } = useStore.getState();
    const t = now();
    const real = Date.now();
    const plan: [string, number, string, string][] = [];
    const list = threats(game, t);
    const find = (kind: string) => list.find((x) => x.kind === kind);
    const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

    const fade = find('fade');
    if (fade) plan.push([WILT_IDS[0], fade.at + 2 * HOUR_MS, 'Your island is getting thirsty', 'A short focus session keeps it green.']);

    const hide = find('hide');
    if (hide?.animalId) {
      const who = upper(callName(hide.animalId, hide.name));
      plan.push([WILT_IDS[1], hide.at - HOUR_MS, `${who} is getting restless`, 'The island is wilting. One session and it stays out.']);
    } else if (fade) {
      plan.push([WILT_IDS[1], fade.at + 0.5 * CONFIG.decay.hoursToEmpty * HOUR_MS, 'Your island is losing its colour', 'One session brings it back.']);
    }

    const leave = find('leave');
    if (leave?.animalId) {
      const who = upper(callName(leave.animalId, leave.name));
      plan.push([WILT_IDS[2], leave.at - 12 * HOUR_MS, `${who} is about to leave`, 'Your island has been dry for days. Focus today and it stays.']);
      plan.push([WILT_IDS[3], leave.at + 60_000, `${who} left your island`, `It comes back after ${CONFIG.stakes.returnDays} days of focus.`]);
    }

    const stump = find('stump');
    if (stump) plan.push([WILT_IDS[4], stump.at - 6 * HOUR_MS, 'Your plants are dying', 'The first one will be a stump in a few hours. A session saves it.']);

    const streak = find('streak');
    if (streak) {
      const n = game.progress.streak;
      plan.push([WILT_IDS[5], streak.at - 4 * HOUR_MS, `Your ${n}-day streak ends tonight`, `Focus ${CONFIG.streak.minQualifyingMin} minutes to keep it.`]);
    }

    for (const [identifier, at, title, body] of plan) {
      const seconds = Math.round((at - t) / 1000);
      if (seconds < 60) continue;
      await N.scheduleNotificationAsync({
        identifier,
        content: { title, body },
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(real + seconds * 1000), channelId: CHANNEL },
      });
    }
  } catch {
    // ignore
  }
}
