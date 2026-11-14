import * as Haptics from 'expo-haptics';
import { useStore } from '../store/store';

type Kind = 'tick' | 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' | 'success' | 'warning' | 'error';

function fire(kind: Kind) {
  switch (kind) {
    case 'tick':
      return Haptics.selectionAsync();
    case 'light':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    case 'medium':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    case 'heavy':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    case 'rigid':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    case 'soft':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    case 'success':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    case 'warning':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    case 'error':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
}

/** Play one haptic. Never throws: devices without a vibration motor just stay silent. */
export function haptic(kind: Kind) {
  if (!useStore.getState().settings.haptics) return;
  try {
    fire(kind).catch(() => {});
  } catch {
    // unavailable on this platform
  }
}

/** Play a rhythm: a list of [delay in ms from the start, haptic]. */
export function hapticPattern(steps: readonly (readonly [number, Kind])[]) {
  const timers = steps.map(([delay, kind]) => setTimeout(() => haptic(kind), delay));
  return () => timers.forEach(clearTimeout);
}

export const PATTERNS = {
  rare: [
    [0, 'medium'],
    [90, 'light'],
    [200, 'success'],
  ],
  epic: [
    [0, 'heavy'],
    [80, 'medium'],
    [160, 'medium'],
    [300, 'success'],
  ],
  legendary: [
    [0, 'heavy'],
    [70, 'heavy'],
    [140, 'rigid'],
    [230, 'medium'],
    [330, 'medium'],
    [450, 'light'],
    [600, 'success'],
    [900, 'light'],
    [1100, 'light'],
  ],
} as const satisfies Record<string, readonly (readonly [number, Kind])[]>;
