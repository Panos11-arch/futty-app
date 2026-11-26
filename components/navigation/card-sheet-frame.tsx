// The bottom sheet a player card sits in (S19's Card button, S20's player
// sheet): over a dimmed screen, with a drag handle. It springs up, and
// closes on a swipe down, a tap outside or the back button. Its content
// scrolls only when it's taller than the sheet. (Moved out of
// my-card-sheet.tsx in S20 so both sheets are the same.)
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MIN_TOUCH, useReduceMotion } from '@/components/ui/foundation';
import { shouldCloseOnSwipe } from '@/components/ui/sheet';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

/** The spring the sheet opens with. */
const SPRING = { damping: 22, stiffness: 220, mass: 1 } as const;

export function CardSheetFrame({
  visible,
  onClose,
  ids,
  closeLabel,
  children,
  overlay,
}: {
  visible: boolean;
  onClose: () => void;
  /** The sheet's, backdrop's and drag handle's testIDs, written out by the
   *  caller (.maestro's check reads them as written). */
  ids: { sheet: { testID: string }; backdrop: { testID: string }; handle: { testID: string } };
  /** The backdrop's label for VoiceOver: "Close card". */
  closeLabel: string;
  children: ReactNode;
  /** Drawn over the sheet, inside the same modal (the full-screen QR). */
  overlay?: ReactNode;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const offscreen = Dimensions.get('window').height;
  const translateY = useRef(new Animated.Value(offscreen)).current;
  const [mounted, setMounted] = useState(visible);
  const [scrollable, setScrollable] = useState(false);
  const box = useRef({ view: 0, content: 0 });

  const latest = useRef({ onClose, reduceMotion });
  latest.current = { onClose, reduceMotion };

  const slideRef = useRef((toValue: number, done?: () => void) => {
    if (latest.current.reduceMotion) {
      translateY.setValue(toValue);
      done?.();
      return;
    }
    Animated.spring(translateY, { toValue, ...SPRING, overshootClamping: toValue > 0, useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) done?.();
      },
    );
  });

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
        // Following the finger is direct manipulation, so it stays on with Reduce Motion.
        onPanResponderMove: (_, g) => translateY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (shouldCloseOnSwipe(g.dy, g.vy)) latest.current.onClose();
          else slideRef.current(0);
        },
        onPanResponderTerminate: () => slideRef.current(0),
      }),
    [translateY],
  );

  function measure(part: 'view' | 'content', height: number) {
    box.current[part] = height;
    setScrollable(box.current.content > box.current.view + 1);
  }

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          {...ids.backdrop}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={styles.scrim}
        />
        <Animated.View
          {...ids.sheet}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg), transform: [{ translateY }] }]}
          {...pan.panHandlers}>
          <View {...ids.handle} accessibilityLabel="Drag down to close" style={styles.grabberZone}>
            <View style={styles.grabber} />
          </View>
          <ScrollView
            scrollEnabled={scrollable}
            bounces={false}
            keyboardShouldPersistTaps="handled"
            onLayout={(e: LayoutChangeEvent) => measure('view', e.nativeEvent.layout.height)}
            onContentSizeChange={(_, h) => measure('content', h)}
            contentContainerStyle={styles.content}>
            {children}
          </ScrollView>
        </Animated.View>
      </View>
      {overlay}
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  sheet: {
    maxHeight: '94%',
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: space.lg,
  },
  grabberZone: { minHeight: MIN_TOUCH / 2 + space.sm, alignItems: 'center', justifyContent: 'center' },
  grabber: {
    width: space.xxl + space.sm,
    height: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.muted,
    opacity: 0.4,
  },
  content: { gap: space.lg, paddingBottom: space.sm },
}));
