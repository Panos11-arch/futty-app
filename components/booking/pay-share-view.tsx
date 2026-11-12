// Pay my share: a player paying their spot in a booking that already exists
// (a "payment due" notification, a joiner, a booker coming back). Every
// amount is booking_detail's `me`, shown as it is.
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CancellationRules, cashSentence, NonRefundableNotice, payLabel } from '@/components/booking/checkout-parts';
import {
  Banner,
  Chip,
  EmptyState,
  PriceBreakdown,
  SkeletonBlock,
  SkeletonText,
  StickyActionBar,
  Text,
} from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import type { PayOptions } from '@/lib/booking-checkout';
import { showNonRefundable, slotLabel, useNow, type LoadState, type PayShareData } from '@/lib/booking-search';

export type PayShareViewProps = {
  data: LoadState<PayShareData>;
  onRetry: () => void;
  onPay: (pay: PayOptions) => void;
  paying: boolean;
  error: string | null;
  /** For tests; the screen uses the clock. */
  now?: Date;
};

const SETTLED: Record<string, string> = {
  authorized: 'Your payment is held.',
  paid: 'Paid.',
  covered: 'The booker paid for your spot.',
};

export function PayShareView(props: PayShareViewProps) {
  const { data } = props;
  if (data.status === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <SkeletonText lines={2} variant="headline" />
          <SkeletonBlock width="100%" height={120} />
        </View>
      </View>
    );
  }
  if (data.status === 'error') {
    return (
      <View style={styles.screen}>
        <EmptyState icon="exclamationmark.circle.fill" message={data.message} action={{ label: 'Try again', onPress: props.onRetry }} />
      </View>
    );
  }
  return <PayShareReady {...props} data={data.data} />;
}

function PayShareReady({
  data,
  onPay,
  paying,
  error,
  now: nowOverride,
}: Omit<PayShareViewProps, 'data' | 'onRetry'> & { data: PayShareData }) {
  const clock = useNow();
  const now = nowOverride ?? clock;
  const [cash, setCash] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const { detail, blocked, cancellation } = data;
  const { booking, venue, me } = detail;
  const pending = me?.status === 'pending';
  const alreadyCash = me?.payment_method === 'cash';
  // Cash only in the each-pays modes and never for a player in debt (spec 13).
  const cashOffered =
    pending && !alreadyCash && !blocked && (booking.payment_mode === 'each_pays_responsible' || booking.payment_mode === 'each_pays_own_spot');
  const cashOn = cash && cashOffered;
  const nonRefundable = pending && showNonRefundable(booking, now);
  const canPay = pending && (!nonRefundable || accepted) && !paying;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">
            {venue.name}
          </Text>
          <Text variant="body" tone="inkMuted" tabular>
            {slotLabel(booking.booking_day, booking.start_time, booking.end_time)}
          </Text>
          <Text variant="body" tone="inkMuted">
            {`${booking.format} · ${booking.players_per_side} v ${booking.players_per_side}`}
          </Text>
        </View>

        {!me ? <Text variant="body">You don’t have a spot in this booking.</Text> : null}
        {me && !pending ? <Text variant="headline">{SETTLED[me.status] ?? 'Nothing to pay for this spot.'}</Text> : null}

        {me && pending ? (
          <View style={styles.section}>
            {cashOffered ? (
              <Chip label="Pay the pitch in cash at the venue" selected={cashOn} onPress={() => setCash((c) => !c)} />
            ) : null}
            {cashOn ? (
              <Text variant="callout">
                You pay the service fee by card now and your part of the pitch in cash at the venue. The next screen shows the exact amount.
              </Text>
            ) : alreadyCash ? (
              <>
                <PriceBreakdown lines={[{ label: 'Service fee', cents: me.fee_cents }]} totalCents={me.amount_cents} totalLabel="By card now" />
                <Text variant="callout">{cashSentence(me.amount_cents, me.cash_cents)}</Text>
              </>
            ) : (
              <PriceBreakdown
                lines={[
                  { label: 'Your part of the pitch', cents: me.pitch_cents },
                  { label: 'Service fee', cents: me.fee_cents },
                ]}
                totalCents={me.amount_cents}
              />
            )}
          </View>
        ) : null}

        {nonRefundable ? <NonRefundableNotice terms={cancellation} accepted={accepted} onToggle={() => setAccepted((a) => !a)} /> : null}

        <CancellationRules terms={cancellation} />

        {error ? <Banner tone="danger" message={error} /> : null}
      </ScrollView>
      {me && pending ? (
        <StickyActionBar
          totalCents={cashOn ? undefined : me.amount_cents}
          totalLabel={alreadyCash ? 'By card now' : 'Total'}
          actionLabel={cashOn ? 'Continue to pay the service fee' : payLabel(me.amount_cents, 'Save my card')}
          loading={paying}
          disabled={!canPay}
          onPress={() => {
            if (!canPay) return;
            onPay({
              method: cashOn || alreadyCash ? 'cash' : 'card',
              acceptNonRefundable: nonRefundable && accepted,
              useCredit: false,
            });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
});
