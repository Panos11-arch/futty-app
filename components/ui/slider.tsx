// A slider drawn in JavaScript (no native module, so no new development
// build). Drag or tap the track; VoiceOver and TalkBack adjust it with swipe
// up and down. Used for Settings → Accessibility → Text size.
import { useMemo, useRef, useState } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';

import { MIN_TOUCH } from '@/components/ui/foundation';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

const THUMB = space.xl + space.xs;

/** Rounds to the nearest step and keeps the value within min and max. */
export function snap(value: number, min: number, max: number, step: number): number {
  const stepped = Math.round((value - min) / step) * step + min;
  const rounded = Math.round(stepped * 1000) / 1000;
  return Math.min(max, Math.max(min, rounded));
}

/** The value under a finger at x on a track this wide. */
export function valueAt(x: number, width: number, min: number, max: number, step: number): number {
  if (width <= 0) return min;
  return snap(min + (x / width) * (max - min), min, max, step);
}

export type SliderProps = {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  accessibilityLabel: string;
  /** What a screen reader says for a value, e.g. "150%". */
  formatValue?: (value: number) => string;
  testID?: string;
};

export function Slider({ value, min, max, step, onChange, accessibilityLabel, formatValue, testID }: SliderProps) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const latest = useRef({ width, value, onChange, min, max, step });
  latest.current = { width, value, onChange, min, max, step };

  const pan = useMemo(() => {
    const move = (x: number) => {
      const l = latest.current;
      const next = valueAt(x, l.width, l.min, l.max, l.step);
      if (next !== l.value) l.onChange(next);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // A sideways drag on the slider never scrolls the screen.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => move(e.nativeEvent.locationX),
      onPanResponderMove: (e) => move(e.nativeEvent.locationX),
    });
  }, []);

  const fraction = max > min ? (value - min) / (max - min) : 0;
  const text = formatValue ? formatValue(value) : String(value);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value, text }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const next = snap(value + (e.nativeEvent.actionName === 'increment' ? step : -step), min, max, step);
        if (next !== value) onChange(next);
      }}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={styles.hit}
      {...pan.panHandlers}>
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.filled, { width: `${fraction * 100}%` }]} />
      </View>
      <View
        pointerEvents="none"
        testID={testID ? `${testID}-thumb` : undefined}
        style={[styles.thumb, { left: Math.max(0, fraction * width - THUMB / 2) }]}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors, hairline }) => ({
  hit: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  track: { height: space.xs + 2, borderRadius: radius.pill, backgroundColor: colors.fill, overflow: 'hidden' },
  filled: { height: '100%', backgroundColor: colors.green },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: hairline * 2,
    borderColor: colors.border,
  },
}));
