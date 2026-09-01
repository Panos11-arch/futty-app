import type { PropsWithChildren, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';

const HIT_SLOP = { top: 15, bottom: 15, left: 15, right: 15 };
const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * The shared step-wizard shell (Book's Day/Time/Location/Quantity/Need flow
 * and League matchmaking's Date/Time/Venue flow both render through this) —
 * title, a thin progress bar, a "Step X of Y · name" label, the step's own
 * content, and one full-width Continue button pinned at the bottom. There is
 * deliberately no close/X: the header's only control is a back chevron,
 * which the caller wires to either "previous step" or "exit the wizard"
 * depending on whether it's on the first step — matching how the reference
 * flow never shows a separate close affordance.
 *
 * Light background by design (not the dark pitch-photo treatment used
 * elsewhere in the app) — that's reserved for the Fixture Confirmed / Match
 * Found screen, which is a celebratory result screen, not a data-entry one.
 *
 * Insets are applied manually via useSafeAreaInsets() rather than
 * <SafeAreaView>, same reasoning as PopupModal: SafeAreaView's automatic
 * detection is unreliable inside a React Native <Modal>.
 */
export function WizardModal({
  visible,
  title,
  stepIndex,
  stepCount,
  stepName,
  onBack,
  continueLabel = 'Continue',
  onContinue,
  continueDisabled,
  continueBusy,
  footerNote,
  children,
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  /** 0-based. */
  stepIndex: number;
  stepCount: number;
  stepName: string;
  /** Always shown as a back chevron — on the first step this should exit
   *  the wizard instead of going to a (nonexistent) previous step. */
  onBack: () => void;
  continueLabel?: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueBusy?: boolean;
  /** Small line under the Continue button — e.g. a charge disclaimer. */
  footerNote?: ReactNode;
}>) {
  const insets = useSafeAreaInsets();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const tint = useThemeColor({}, 'tint');
  const onTint = useThemeColor({}, 'background');

  const slideAnim = useRef(new Animated.Value(0)).current;
  const prevIndexRef = useRef(stepIndex);
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    const direction = stepIndex > prevIndexRef.current ? 1 : -1;
    prevIndexRef.current = stepIndex;
    slideAnim.setValue(direction * SCREEN_WIDTH * 0.4);
    Animated.timing(slideAnim, { toValue: 0, duration: 240, useNativeDriver: true }).start();
  }, [stepIndex, slideAnim]);

  const progress = (stepIndex + 1) / stepCount;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onBack}>
      <View style={[styles.flex, { backgroundColor: FuttyColors.stone50 }]}>
        <View style={[styles.flex, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={onBack}
              hitSlop={HIT_SLOP}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <IconSymbol name="chevron.left" size={20} color={FuttyColors.stone900} />
            </Pressable>
            <ThemedText type="defaultSemiBold" style={styles.title}>
              {title}
            </ThemedText>
            <View style={styles.backButtonPlaceholder} />
          </View>

          <View style={styles.progressSection}>
            <View style={[styles.progressTrack, { backgroundColor: border }]}>
              <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: tint }]} />
            </View>
            <ThemedText style={styles.stepLabel}>
              Step {stepIndex + 1} of {stepCount} · {stepName}
            </ThemedText>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Animated.View style={{ transform: [{ translateX: slideAnim }] }}>{children}</Animated.View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !!continueDisabled }}
              onPress={onContinue}
              disabled={continueDisabled || continueBusy}
              style={({ pressed }) => [
                styles.continueButton,
                { backgroundColor: tint },
                (continueDisabled || continueBusy) && styles.continueButtonDisabled,
                pressed && !continueDisabled && !continueBusy && styles.pressed,
              ]}>
              <ThemedText style={[styles.continueButtonText, { color: onTint }]}>
                {continueBusy ? 'Please wait…' : continueLabel}
              </ThemedText>
            </Pressable>
            {footerNote}
          </View>
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 52,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FuttyColors.stone200,
  },
  backButtonPlaceholder: {
    width: 36,
    height: 36,
  },
  pressed: {
    opacity: 0.7,
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
  progressSection: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 6,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  stepLabel: {
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
  body: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 8,
  },
  continueButton: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonDisabled: {
    opacity: 0.4,
  },
  continueButtonText: {
    fontFamily: FuttyFonts.sansBold,
    fontSize: 16,
  },
});
