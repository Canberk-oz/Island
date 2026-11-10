import React, { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { haptic } from '../feel/haptics';
import { playSound } from '../feel/sound';
import { colors, fonts, motion, radius } from './theme';

type Weight = keyof typeof fonts;

export function Txt({
  weight = 'bold',
  size = 15,
  color = colors.ink,
  center,
  style,
  ...rest
}: TextProps & { weight?: Weight; size?: number; color?: string; center?: boolean }) {
  return (
    <Text
      allowFontScaling={false}
      {...rest}
      style={[
        { fontFamily: fonts[weight], fontSize: size, color, includeFontPadding: false } as TextStyle,
        center && { textAlign: 'center' },
        style,
      ]}
    />
  );
}

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Haptic on press-in. */
  feel?: 'tick' | 'light' | 'medium' | 'none';
  /** Play the tap sound. */
  sound?: boolean;
  /** How far the view shrinks while held. */
  depth?: number;
  children?: React.ReactNode;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A pressable that squashes when held and springs back with a little overshoot. */
export function PressableScale({
  style,
  feel = 'light',
  sound = true,
  depth = 0.93,
  onPressIn,
  onPressOut,
  disabled,
  children,
  ...rest
}: PressableScaleProps) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        s.value = withSpring(depth, motion.press);
        if (feel !== 'none') haptic(feel);
        if (sound) playSound('tap', 0.6);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, motion.wobble);
        onPressOut?.(e);
      }}
      style={[style, anim, disabled && { opacity: 0.45 }]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function Button({
  label,
  sub,
  onPress,
  tone = 'primary',
  disabled,
  style,
  feel = 'medium',
  testID,
}: {
  label: string;
  sub?: string;
  onPress: () => void;
  tone?: 'primary' | 'ghost' | 'gold' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  feel?: PressableScaleProps['feel'];
  testID?: string;
}) {
  const bg = { primary: colors.leaf, ghost: 'rgba(255,255,255,0.75)', gold: colors.coin, danger: colors.danger }[tone];
  const edge = { primary: colors.leafDark, ghost: colors.cardEdge, gold: colors.coinDark, danger: '#B9503F' }[tone];
  const fg = tone === 'ghost' ? colors.ink : colors.white;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      feel={feel}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.button, { backgroundColor: bg, borderBottomColor: edge }, style]}
    >
      <Txt weight="black" size={18} color={fg}>
        {label}
      </Txt>
      {sub ? (
        <Txt weight="bold" size={12} color={fg} style={{ opacity: 0.85, marginTop: 1 }}>
          {sub}
        </Txt>
      ) : null}
    </PressableScale>
  );
}

export function Card({ style, children }: { style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.coin,
        borderWidth: Math.max(1.5, size * 0.12),
        borderColor: colors.coinDark,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: size * 0.22, height: size * 0.42, borderRadius: size * 0.1, backgroundColor: '#FFE7A8' }} />
    </View>
  );
}

/** A small rounded stat chip. It pops whenever `value` changes. */
export function Pill({
  icon,
  value,
  tint = 'rgba(255,255,255,0.82)',
  color = colors.ink,
  style,
}: {
  icon: React.ReactNode;
  value: string | number;
  tint?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useSharedValue(1);
  const first = React.useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    s.value = withSequence(withTiming(1.22, { duration: 110, easing: Easing.out(Easing.quad) }), withSpring(1, motion.wobble));
  }, [value, s]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Animated.View style={[styles.pill, { backgroundColor: tint }, style, anim]}>
      {icon}
      <Txt weight="heavy" size={15} color={color} style={{ marginLeft: 6 }}>
        {value}
      </Txt>
    </Animated.View>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    x.value = withSpring(value ? 1 : 0, motion.press);
  }, [value, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 20 }] }));
  return (
    <Pressable
      onPress={() => {
        haptic('tick');
        playSound('tick');
        onChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={styles.toggleRow}
    >
      <Txt size={15}>{label}</Txt>
      <View style={[styles.toggleTrack, { backgroundColor: value ? colors.leaf : '#D8D2C4' }]}>
        <Animated.View style={[styles.toggleKnob, knob]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 58,
    paddingHorizontal: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 5,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.cardEdge,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 36,
    borderRadius: radius.pill,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  toggleTrack: { width: 48, height: 28, borderRadius: 14, padding: 3 },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white },
});
