import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** A pinch's zoom, kept between 1x and 4x. */
export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * A chat photo full screen on night: pinch to zoom (1x to 4x), drag while
 * zoomed, double tap to reset, and a close button. The gestures run on the JS
 * thread with React Native's Animated (no worklets), which is plenty for one
 * still photo.
 */
export function PhotoViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(1)).current;
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const at = useRef({ scale: 1, x: 0, y: 0 }).current;

  function reset() {
    at.scale = 1;
    at.x = 0;
    at.y = 0;
    scale.setValue(1);
    x.setValue(0);
    y.setValue(0);
  }

  useEffect(reset, [uri]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onUpdate((e) => scale.setValue(clampZoom(at.scale * e.scale)))
    .onEnd((e) => {
      at.scale = clampZoom(at.scale * e.scale);
      if (at.scale === MIN_ZOOM) reset();
    });
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minPointers(1)
    .onUpdate((e) => {
      if (at.scale === MIN_ZOOM) return;
      x.setValue(at.x + e.translationX);
      y.setValue(at.y + e.translationY);
    })
    .onEnd((e) => {
      if (at.scale === MIN_ZOOM) return;
      at.x += e.translationX;
      at.y += e.translationY;
    });
  const doubleTap = Gesture.Tap().runOnJS(true).numberOfTaps(2).onEnd(reset);

  return (
    <Modal visible={!!uri} transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.screen}>
        <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
          <View style={styles.screen} testID="ai-photo-viewer">
            {uri ? (
              <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }, { translateY: y }, { scale }] }]}>
                <Image
                  source={{ uri }}
                  contentFit="contain"
                  style={StyleSheet.absoluteFill}
                  accessibilityLabel="Photo. Pinch to zoom."
                  testID="ai-photo-full"
                />
              </Animated.View>
            ) : null}
          </View>
        </GestureDetector>
        <Pressable
          testID="ai-photo-close"
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          onPress={onClose}
          style={[styles.close, { top: insets.top + space.sm }]}>
          <IconSymbol name="xmark" size={ICON.regular} color={colors.onNight} />
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.night },
  close: {
    position: 'absolute',
    left: space.md,
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
