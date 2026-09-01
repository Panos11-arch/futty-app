import type { PropsWithChildren, ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';

// Generous touch target beyond the button's own 32x32 visual bounds — the
// object form (not the numeric shorthand) per the item 1/2 fix, so there's
// no ambiguity about it being applied on every side.
const HIT_SLOP = { top: 15, bottom: 15, left: 15, right: 15 };

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
  /** Full-bleed background (e.g. the pitch graphic behind the booking
   *  wizard / Fixture Confirmed) rendered behind the header+body+footer. */
  backgroundImage?: ReactNode;
  /** Set when backgroundImage is a dark/busy image — switches header text,
   *  icons and controls to light-on-dark instead of the default. */
  dark?: boolean;
  /** Fixed row between the header and the (possibly-animated/scrolling)
   *  body — e.g. a step-progress indicator that shouldn't move when the
   *  step content slides. */
  subHeader?: ReactNode;
}>) {
  const insets = useSafeAreaInsets();
  const lightBorder = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const border = dark ? 'rgba(255,255,255,0.25)' : lightBorder;
  const iconColor = dark ? FuttyColors.white : FuttyColors.stone700;
  const buttonBg = dark ? 'rgba(255,255,255,0.18)' : FuttyColors.stone50;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.flex}>
        {backgroundImage}
        <View style={[styles.flex, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={[styles.header, { borderBottomColor: border }]}>
            {onBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={onBack}
                hitSlop={HIT_SLOP}
                style={({ pressed }) => [styles.roundButton, { backgroundColor: buttonBg }, pressed && styles.pressed]}>
                <IconSymbol name="chevron.left" size={18} color={iconColor} />
              </Pressable>
            ) : (
              <View style={styles.roundButtonPlaceholder} />
            )}

            {title ? (
              <ThemedText
                type="defaultSemiBold"
                style={[styles.title, dark && styles.titleDark]}>
                {title}
              </ThemedText>
            ) : (
              <View style={styles.title} />
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={HIT_SLOP}
              style={({ pressed }) => [styles.roundButton, { backgroundColor: buttonBg }, pressed && styles.pressed]}>
              <IconSymbol name="xmark" size={20} color={iconColor} />
            </Pressable>
          </View>

          {subHeader}

          <View style={styles.body}>{children}</View>

          {footer ? (
            <View style={[styles.footer, { borderTopColor: border, paddingBottom: insets.bottom > 0 ? 16 : 24 }]}>
              {footer}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
    borderBottomWidth: 1,
    // Belt-and-braces: guarantees this row draws and is hit-tested above
    // the body's ScrollView/FlatList, on top of the real (gesture-handler)
    // fix above.
    zIndex: 10,
    elevation: 10,
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
  titleDark: {
    color: FuttyColors.white,
  },
  roundButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonPlaceholder: {
    width: 36,
    height: 36,
  },
  pressed: {
    opacity: 0.6,
  },
  body: {
    flex: 1,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
});
