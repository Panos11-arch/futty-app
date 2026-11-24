// Leaving or pulling out of a Losers pay game (spec 13 "Losers pay (Gipedo
// Pano in Booking v2)", "Pulling out", decided 23 and 24 November): what
// it does to the money, from the server's quote, then one confirmation.
// If the money changed between the quote and the tap (his free hour ended,
// kickoff got closer), the new quote is shown to check again.
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Banner, Button, EmptyState, SkeletonText, Text } from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import type { LoadState } from '@/lib/booking-search';
import {
  actionTitle,
  confirmLabel,
  doneMessage,
  keepLabel,
  quoteLines,
  type LosersPayAction,
  type LosersPayQuote,
} from '@/lib/booking-losers-pay';

export type ConfirmOutcome =
  | { status: 'done' }
  | { status: 'changed'; quote: LosersPayQuote }
  | { status: 'error'; message: string };

export type LosersPayLeaveViewProps = {
  action: LosersPayAction;
  state: LoadState<LosersPayQuote>;
  onRetry: () => void;
  onConfirm: (shown: LosersPayQuote) => Promise<ConfirmOutcome>;
  onKeep: () => void;
  onDone: () => void;
};

export function LosersPayLeaveView(props: LosersPayLeaveViewProps) {
  const { state } = props;
  if (state.status === 'loading') {
    return (
      <View testID="losers-pay-leave-loading" style={styles.screen}>
        <View style={styles.content}>
          <SkeletonText lines={3} variant="body" />
        </View>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="exclamationmark.circle.fill"
          message={state.message}
          action={{ label: 'Try again', onPress: props.onRetry }}
        />
      </View>
    );
  }
  return <Ready {...props} initial={state.data} />;
}

function Ready({ action, initial, onConfirm, onKeep, onDone }: LosersPayLeaveViewProps & { initial: LosersPayQuote }) {
  const [quote, setQuote] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function confirm() {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    const outcome = await onConfirm(quote);
    setBusy(false);
    if (outcome.status === 'done') {
      setDone(true);
    } else if (outcome.status === 'changed') {
      setQuote(outcome.quote);
      setChanged(true);
    } else {
      setError(outcome.message);
    }
  }

  return (
    <View testID="losers-pay-leave-screen" style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.group}>
          <Text variant="title" accessibilityRole="header">
            {actionTitle(action)}
          </Text>
          <Text variant="callout" tone="inkMuted">
            This is a Losers pay game.
          </Text>
        </View>

        {changed && !done ? (
          <View testID="losers-pay-leave-changed">
            <Banner tone="warning" message="What happens to the money has changed. Check it again before you confirm." />
          </View>
        ) : null}

        <View testID="losers-pay-leave-quote" style={styles.group}>
          {quoteLines(quote).map((line, i) => (
            <Text key={line} testID={`losers-pay-leave-line-${i}`} variant="body">
              {line}
            </Text>
          ))}
        </View>

        {error ? (
          <View testID="losers-pay-leave-error">
            <Banner tone="danger" message={error} />
          </View>
        ) : null}

        {done ? (
          <View style={styles.section}>
            <View testID="losers-pay-leave-done">
              <Banner tone="info" message={doneMessage(action, quote)} />
            </View>
            <Button testID="losers-pay-leave-back" label="Back to the booking" onPress={onDone} fullWidth />
          </View>
        ) : (
          <View style={styles.section}>
            <Button
              testID="losers-pay-leave-confirm"
              label={confirmLabel(action, quote)}
              variant="destructive"
              loading={busy}
              disabled={busy}
              onPress={confirm}
              fullWidth
            />
            <Button testID="losers-pay-leave-keep" label={keepLabel(action)} variant="secondary" disabled={busy} onPress={onKeep} fullWidth />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
  group: { gap: space.xs },
});
