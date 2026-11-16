// The venue dashboard's Payouts screen (P4d; spec 05 section 12 item 10):
// Stripe onboarding and its status, the money on its way or owed, the list
// of payouts, and, for each, what each booking paid. Every amount is the
// server's (lib/payouts.ts puts it into words).
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  EmptyState,
  ListRow,
  SectionHeader,
  Sheet,
  SkeletonBlock,
  SkeletonText,
  StatusPill,
  Text,
} from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import type { LoadState } from '@/lib/booking-search';
import {
  accountWords,
  balanceWords,
  bookingMoneyLines,
  cyprusWhen,
  payoutRowWords,
  payoutStatus,
  type PayoutDetail,
  type PayoutsOverview,
  type StripeAction,
} from '@/lib/payouts';
import { formatEuros } from '@/lib/money/format';

export type PayoutsViewProps = {
  state: LoadState<PayoutsOverview>;
  venueName: string;
  onRetry: () => void;
  /** Opens Stripe; resolves to an error message, or null once it closed. */
  onStripe: (action: StripeAction) => Promise<string | null>;
  /** One payout's bookings. */
  onOpenPayout: (payoutId: string) => Promise<{ detail: PayoutDetail } | { error: string }>;
};

type Opened = { id: string; step: 'loading' } | { id: string; step: 'ready'; detail: PayoutDetail } | { id: string; step: 'error'; message: string };

export function PayoutsView({ state, venueName, onRetry, onStripe, onOpenPayout }: PayoutsViewProps) {
  const [busy, setBusy] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  // Only the payout opened last may fill the sheet.
  const openRef = useRef(0);

  if (state.status === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <SkeletonText lines={2} variant="headline" />
          <SkeletonBlock width="100%" height={space.xxl * 4} />
        </View>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.screen}>
        <EmptyState icon="exclamationmark.circle.fill" message={state.message} action={{ label: 'Try again', onPress: onRetry }} />
      </View>
    );
  }

  const overview = state.data;
  const account = accountWords(overview.account);
  const balance = balanceWords(overview);

  async function stripe(action: StripeAction) {
    if (busy) return;
    setBusy(true);
    setStripeError(null);
    const message = await onStripe(action);
    setBusy(false);
    setStripeError(message);
  }

  async function open(id: string) {
    const ask = ++openRef.current;
    setOpened({ id, step: 'loading' });
    const result = await onOpenPayout(id);
    if (openRef.current !== ask) return;
    setOpened('detail' in result ? { id, step: 'ready', detail: result.detail } : { id, step: 'error', message: result.error });
  }

  function close() {
    openRef.current += 1;
    setOpened(null);
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="title" accessibilityRole="header">
          {venueName}
        </Text>

        <View style={styles.section}>
          <Banner tone={account.tone} title={account.title} message={account.body} />
          {account.action ? (
            <Button
              label={account.action.label}
              variant={account.action.kind === 'onboard' ? 'primary' : 'secondary'}
              onPress={() => stripe(account.action!.kind)}
              loading={busy}
              fullWidth
            />
          ) : null}
          {stripeError ? <Banner tone="danger" message={stripeError} /> : null}
        </View>

        {balance.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="Not sent yet" />
            {balance.map((line) => (
              <Text key={line} variant="body" tabular>
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader title="Payouts" />
          {overview.payouts.length === 0 ? (
            <Text variant="body" tone="inkMuted">
              No payouts yet. Each booking&apos;s money is sent once it&apos;s final, after the match.
            </Text>
          ) : (
            <View style={styles.list}>
              {overview.payouts.map((row) => {
                const words = payoutRowWords(row);
                const status = payoutStatus(row.status);
                return (
                  <ListRow
                    key={row.id}
                    testID={`payout-${row.id}`}
                    title={words.title}
                    subtitle={`${status.words} · ${words.subtitle}`}
                    trailing={
                      <View style={styles.trailing}>
                        <Text variant="callout" tabular>
                          {words.amount}
                        </Text>
                        <StatusPill status={status.pill} />
                      </View>
                    }
                    chevron
                    onPress={() => open(row.id)}
                    accessibilityLabel={`${words.title}, ${words.amount}, ${status.words}`}
                  />
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <Sheet
        visible={opened !== null}
        onClose={close}
        title={opened?.step === 'ready' ? `Payout of ${formatEuros(opened.detail.amount_cents)}` : 'Payout'}
        secondaryAction={{ label: 'Close' }}>
        {opened?.step === 'loading' ? <SkeletonText lines={4} variant="body" /> : null}
        {opened?.step === 'error' ? <Banner tone="danger" message={opened.message} /> : null}
        {opened?.step === 'ready' ? (
          <>
            <Text variant="callout" tone="inkMuted">
              {`${payoutStatus(opened.detail.status).words} · ${cyprusWhen(opened.detail.sent_at ?? opened.detail.created_at)}`}
            </Text>
            {opened.detail.bookings.map((booking) => (
              <View key={booking.booking_id} style={styles.booking} testID={`payout-booking-${booking.booking_id}`}>
                <Text variant="headline">{booking.label}</Text>
                {booking.this_payout_cents !== undefined ? (
                  <Text variant="callout" tabular>
                    {`In this payout: ${formatEuros(booking.this_payout_cents)}`}
                  </Text>
                ) : null}
                {bookingMoneyLines(booking).map((line) => (
                  <View key={line.label} style={styles.line}>
                    <Text variant="callout" tone="inkMuted">
                      {line.label}
                    </Text>
                    <Text variant="callout" tabular>
                      {line.amount}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
  list: { gap: space.xs },
  trailing: { alignItems: 'flex-end', gap: space.xs },
  booking: { gap: space.xs, paddingTop: space.md },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
});
