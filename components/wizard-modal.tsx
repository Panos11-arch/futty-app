import type { PropsWithChildren, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { MIN_TOUCH, MOTION, useReduceMotion } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { hairline, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * The shared step-wizard shell (League matchmaking's Date/Time/Venue flow
 * renders through this) — title, a "Step X of Y · name" line, the step's own
 * content, and one full-width Continue button pinned at the bottom. There is
 * deliberately no close/X: the header's only control is a back chevron,
 * which the caller wires to either "previous step" or "exit the wizard"
 * depending on whether it's on the first step.
 *
 * Progress is plain text, not a coloured bar (U7, docs/specs/15-design.md).
 * The step slide is 250 ms and skipped when Reduce motion is on.
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
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

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
    if (reduceMotion) {
      slideAnim.setValue(0);
      return;
    }
    slideAnim.setValue(direction * SCREEN_WIDTH * 0.4);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: MOTION.duration,
      easing: MOTION.easing,
      useNativeDriver: true,
    }).start();
  }, [stepIndex, slideAnim, reduceMotion]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onBack}>
      <View style={styles.screen}>
        <View style={[styles.flex, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.header}>
            <IconButton icon="chevron.left" accessibilityLabel="Back" onPress={onBack} />
            <Text variant="headline" accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <View style={styles.placeholder} />
          </View>

          <View style={styles.progressSection}>
            <Text variant="callout" tone="inkMuted" tabular testID="wizard-step">
              Step {stepIndex + 1} of {stepCount} · {stepName}
            </Text>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Animated.View style={{ transform: [{ translateX: slideAnim }] }}>{children}</Animated.View>
          </ScrollView>

          <View style={styles.footer}>
            <Button
              label={continueLabel}
              fullWidth
              onPress={onContinue}
              disabled={continueDisabled}
              loading={continueBusy}
            />
            {footerNote}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  placeholder: { width: MIN_TOUCH, height: MIN_TOUCH },
  title: { flex: 1, textAlign: 'center' },
  progressSection: { paddingHorizontal: space.lg, paddingBottom: space.md },
  body: { flexGrow: 1, paddingHorizontal: space.lg, paddingBottom: space.lg },
  footer: {
    backgroundColor: colors.surface,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.sm,
  },
}));
