import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Dimensions, Modal, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { MOTION, useReduceMotion } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { colors, radius, space } from '@/constants/futty-theme';

/** Drag further than this, in points, to close. */
const SWIPE_CLOSE_DISTANCE = 80;
/** Or flick down faster than this, in points per millisecond. */
const SWIPE_CLOSE_VELOCITY = 0.5;
/** The dimmed screen behind the sheet: ink at this opacity. */
const SCRIM_OPACITY = 0.4;

export function shouldCloseOnSwipe(dy: number, vy: number): boolean {
  return dy > SWIPE_CLOSE_DISTANCE || (dy > 0 && vy > SWIPE_CLOSE_VELOCITY);
}

export type SheetAction = { label: string; onPress?: () => void; loading?: boolean; disabled?: boolean };

export type SheetProps = {
  visible: boolean;
  /** Called on the close button, the backdrop, a swipe down and the secondary action. */
  onClose: () => void;
  title: string;
  children?: ReactNode;
  /** Does not close the sheet by itself (it may be "Pay €6.80"). */
  primaryAction?: SheetAction & { onPress: () => void };
  /** Runs its onPress, if any, then closes the sheet. */
  secondaryAction?: SheetAction;
};

/** Bottom sheet. Slides up in 250 ms, or appears at once with Reduce Motion on. */
export function Sheet({ visible, onClose, title, children, primaryAction, secondaryAction }: SheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const offscreen = Dimensions.get('window').height;
  const translateY = useRef(new Animated.Value(offscreen)).current;
  const [mounted, setMounted] = useState(visible);

  // Latest values for the long-lived PanResponder callbacks.
  const latest = useRef({ onClose, reduceMotion });
  latest.current = { onClose, reduceMotion };

  const slideTo = (toValue: number, done?: () => void) => {
    if (latest.current.reduceMotion) {
      translateY.setValue(toValue);
      done?.();
      return;
    }
    Animated.timing(translateY, {
      toValue,
      duration: MOTION.duration,
      easing: MOTION.easing,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) done?.();
    });
  };
  const slideRef = useRef(slideTo);
  slideRef.current = slideTo;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slideRef.current(0);
    } else {
      slideRef.current(offscreen, () => setMounted(false));
    }
  }, [visible, offscreen]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => {},
        // Following the finger is direct manipulation, not animation, so it stays on with Reduce Motion.
        onPanResponderMove: (_, g) => translateY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (shouldCloseOnSwipe(g.dy, g.vy)) latest.current.onClose();
          else slideRef.current(0);
        },
        onPanResponderTerminate: () => slideRef.current(0),
      }),
    [translateY],
  );

  const runSecondary = () => {
    secondaryAction?.onPress?.();
    onClose();
  };

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          importantForAccessibility="no"
          accessibilityElementsHidden
          onPress={onClose}
          style={styles.scrim}
        />
        <Animated.View
          testID="sheet"
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, space.lg), transform: [{ translateY }] },
          ]}
          {...pan.panHandlers}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text variant="title" accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <IconButton icon="xmark" accessibilityLabel="Close" tone="inkMuted" onPress={onClose} />
          </View>
          {children ? <View style={styles.content}>{children}</View> : null}
          {primaryAction || secondaryAction ? (
            <View style={styles.actions}>
              {primaryAction ? (
                <Button
                  label={primaryAction.label}
                  onPress={primaryAction.onPress}
                  loading={primaryAction.loading}
                  disabled={primaryAction.disabled}
                  fullWidth
                />
              ) : null}
              {secondaryAction ? (
                <Button
                  label={secondaryAction.label}
                  variant="secondary"
                  onPress={runSecondary}
                  loading={secondaryAction.loading}
                  disabled={secondaryAction.disabled}
                  fullWidth
                />
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.ink, opacity: SCRIM_OPACITY },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: space.xxl + space.sm,
    height: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1 },
  content: { gap: space.md },
  actions: { gap: space.sm },
});
