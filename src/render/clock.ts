import { useEffect } from 'react';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * An ever-increasing millisecond clock on the UI thread that drives all idle
 * motion (swaying, drifting, bobbing). It can be paused to save battery.
 */
export function useClockMs(active = true): SharedValue<number> {
  const clock = useSharedValue(0);
  const frame = useFrameCallback((info) => {
    'worklet';
    clock.value += Math.min(64, info.timeSincePreviousFrame ?? 16);
  }, active);
  useEffect(() => {
    frame.setActive(active);
  }, [active, frame]);
  return clock;
}
