import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';

import { MOTION, useReduceMotion } from '@/components/ui/foundation';
import { FuttyLogo } from '@/components/ui/futty-logo';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

const DOT = space.sm;

/** While Futty AI answers: its avatar and three pulsing dots (still with Reduce Motion on). */
export function TypingIndicator() {
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.4))).current;

  useEffect(() => {
    if (reduceMotion) return;
    const pulse = (v: Animated.Value) =>
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: MOTION.duration, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.4, duration: MOTION.duration, useNativeDriver: true }),
      ]);
    const loop = Animated.loop(Animated.stagger(MOTION.duration / 2, dots.map(pulse)));
    loop.start();
    return () => loop.stop();
  }, [dots, reduceMotion]);

  return (
    <View
      style={styles.row}
      testID="ai-typing"
      accessible
      accessibilityLabel="Futty AI is typing"
      accessibilityLiveRegion="polite">
      <FuttyLogo size={space.xl} />
      <View style={styles.bubble}>
        {dots.map((v, i) => (
          <Animated.View key={i} style={[styles.dot, { opacity: v }]} />
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.sm },
  bubble: {
    flexDirection: 'row',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.card,
    borderBottomLeftRadius: space.xs,
    backgroundColor: colors.surface,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  dot: { width: DOT, height: DOT, borderRadius: radius.pill, backgroundColor: colors.muted },
}));
