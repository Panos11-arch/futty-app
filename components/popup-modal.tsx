import type { PropsWithChildren, ReactNode } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MIN_TOUCH } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';

/**
 * The one popup/modal shell for the whole app (items 1 & 2) — every full-
 * screen popup (AI chat, the booking wizard steps, Fixture Confirmed, the
 * country picker) renders through this so there's exactly one close-button
 * implementation to get right, instead of each screen re-implementing its
 * own slightly different header.
 *
 * The close button itself was never the touch-delivery bug (see
 * app/_layout.tsx's GestureHandlerRootView fix for that root cause) — this
 * component exists so that fix only has to be trusted once, not per-popup.
 *
 * Insets are applied manually via useSafeAreaInsets() rather than
 * <SafeAreaView>: a later usability pass found the header/close button
 * rendering under the notch/status bar on every wizard step. SafeAreaView's
 * automatic detection is unreliable specifically inside a React Native
 * <Modal> — the modal presents in its own native surface, and there's no
 * guarantee it's remeasured against the same SafeAreaProvider context the
 * rest of the app uses. Reading the insets explicitly and applying them as
 * padding sidesteps that entirely.
 *
 * Look (U7, docs/specs/15-design.md): surface header with a hairline, a
 * headline title, 44 pt icon buttons, canvas body.
 */
export function PopupModal({
  visible,
  onClose,
  onBack,
  title,
  footer,
  children,
  backgroundImage,
  dark,
  subHeader,
}: PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  /** Shows a back chevron on the left instead of blank space — for a step
   *  in a multi-step wizard. */
  onBack?: () => void;
  title?: string;
  /** Pinned below the scrollable body — e.g. a primary "Find pitches" /
   *  "Next" action, or a chat input row. */
  footer?: ReactNode;
  /** Full-bleed background rendered behind the header+body+footer. */
  backgroundImage?: ReactNode;
  /** Set when backgroundImage is a dark/busy image — the title switches to
   *  light text and the buttons sit on a surface pill so they stay legible. */
  dark?: boolean;
  /** Fixed row between the header and the (possibly-animated/scrolling)
   *  body — e.g. a step-progress indicator that shouldn't move when the
   *  step content slides. */
  subHeader?: ReactNode;
}>) {
  const insets = useSafeAreaInsets();
  const plain = !backgroundImage;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.flex, plain && styles.canvas]}>
        {backgroundImage}
        <View style={[styles.flex, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={[styles.header, !dark && styles.headerSurface]}>
            {onBack ? (
              <View style={dark && styles.onImage}>
                <IconButton icon="chevron.left" accessibilityLabel="Back" onPress={onBack} />
              </View>
            ) : (
              <View style={styles.placeholder} />
            )}

            {title ? (
              <Text variant="headline" tone={dark ? 'onBrand' : 'ink'} accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
            ) : (
              <View style={styles.title} />
            )}

            <View style={dark && styles.onImage}>
              <IconButton icon="xmark" accessibilityLabel="Close" onPress={onClose} />
            </View>
          </View>

          {subHeader}

          <View style={styles.body}>{children}</View>

          {footer ? (
            <View style={[styles.footer, !dark && styles.footerSurface, { paddingBottom: insets.bottom > 0 ? space.lg : space.xl }]}>
              {footer}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  canvas: { backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    minHeight: MIN_TOUCH + space.md,
    // Belt-and-braces: guarantees this row draws and is hit-tested above
    // the body's ScrollView/FlatList, on top of the real (gesture-handler)
    // fix above.
    zIndex: 10,
    elevation: 10,
  },
  headerSurface: {
    backgroundColor: colors.surface,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  onImage: { backgroundColor: colors.surface, borderRadius: radius.pill },
  title: { flex: 1, textAlign: 'center' },
  placeholder: { width: MIN_TOUCH, height: MIN_TOUCH },
  body: { flex: 1 },
  footer: { paddingHorizontal: space.lg, paddingTop: space.lg },
  footerSurface: {
    backgroundColor: colors.surface,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
  },
});
