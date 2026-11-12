// "Pay what I owe" (spec 15 section 5, "Debt and credit"; spec 13 "Cash,
// debt and venue credit"): each debt with who it's owed to, each payment that
// didn't go through, and credit per venue with its expiry. Every amount is
// my_owed's or my_credit's, shown as it is: paying a debt adds no fee.
import { ScrollView, StyleSheet, View } from 'react-native';

import { Banner, Button, Card, EmptyState, SectionHeader, SkeletonBlock, SkeletonText, Text } from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import type { LoadState } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import {
  debtReasonLabel,
  expiryLabel,
  owedToName,
  owedWhen,
  paymentActionLabel,
  paymentSentence,
  type Owed,
  type OwedDebt,
  type OwedPayment,
  type VenueCredit,
} from '@/lib/use-owed';

/** One thing on the screen that can be paid. */
export type OwedItem = { type: 'debt'; debt: OwedDebt } | { type: 'payment'; payment: OwedPayment };

/** A stable key for an item, so the screen knows which one is paying. */
export function owedItemKey(item: OwedItem): string {
  return item.type === 'debt'
    ? `debt:${item.debt.debt_id}`
    : `${item.payment.kind}:${item.payment.booking_id}:${item.payment.share_id ?? ''}`;
}

export type OwedViewProps = {
  owed: LoadState<Owed>;
  credit: LoadState<VenueCredit[]>;
  onRetryOwed: () => void;
  onRetryCredit: () => void;
  onPay: (item: OwedItem) => void;
  /** owedItemKey of the item being paid, or null. */
  payingKey: string | null;
  /** After paying (info) or when it failed (danger). */
  message: { tone: 'info' | 'danger'; text: string } | null;
};

export function OwedView(props: OwedViewProps) {
  const { message } = props;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {message ? <Banner tone={message.tone} message={message.text} /> : null}
      <OwedSections {...props} />
      <CreditSection credit={props.credit} onRetry={props.onRetryCredit} />
    </ScrollView>
  );
}

function OwedSections({ owed, onRetryOwed, onPay, payingKey }: OwedViewProps) {
  if (owed.status === 'loading') {
    return (
      <View testID="owed-skeleton" style={styles.section}>
        <SkeletonText lines={1} variant="headline" />
        <SkeletonBlock width="100%" height={96} />
      </View>
    );
  }
  if (owed.status === 'error') {
    return (
      <EmptyState icon="exclamationmark.circle.fill" message={owed.message} action={{ label: 'Try again', onPress: onRetryOwed }} />
    );
  }
  const { debts, payments, debt_cents } = owed.data;
  const busy = payingKey !== null;
  return (
    <>
      <View style={styles.section}>
        <SectionHeader title="What you owe" />
        {debts.length === 0 ? (
          <Text variant="body" tone="inkMuted">
            You don’t owe anything.
          </Text>
        ) : (
          <>
            <Text variant="headline" tabular>
              {`You owe ${formatEuros(debt_cents)}`}
            </Text>
            <Text variant="callout" tone="inkMuted">
              You can’t book, join a game or pay cash until it’s paid. Paying adds no service fee.
            </Text>
            {debts.map((debt) => {
              const item: OwedItem = { type: 'debt', debt };
              const key = owedItemKey(item);
              return (
                <Card key={key} testID={`debt-${debt.debt_id}`} style={styles.card}>
                  <View style={styles.titleRow}>
                    <View style={styles.titleText}>
                      <Text variant="headline">{owedToName(debt)}</Text>
                      <Text variant="callout" tone="inkMuted">
                        {debtReasonLabel(debt.reason)}
                      </Text>
                    </View>
                    <Text variant="headline" tabular>
                      {formatEuros(debt.amount_cents)}
                    </Text>
                  </View>
                  <Button
                    label={`Pay ${formatEuros(debt.amount_cents)}`}
                    loading={payingKey === key}
                    disabled={busy}
                    onPress={() => onPay(item)}
                  />
                </Card>
              );
            })}
          </>
        )}
      </View>

      {payments.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Payments to finish" />
          {payments.map((payment) => {
            const item: OwedItem = { type: 'payment', payment };
            const key = owedItemKey(item);
            return (
              <Card key={key} testID={`payment-${key}`} style={styles.card}>
                <View style={styles.titleRow}>
                  <View style={styles.titleText}>
                    <Text variant="headline">{payment.venue_name}</Text>
                    <Text variant="callout" tone="inkMuted" tabular>
                      {owedWhen(payment)}
                    </Text>
                  </View>
                  {payment.amount_cents !== null ? (
                    <Text variant="headline" tabular>
                      {formatEuros(payment.amount_cents)}
                    </Text>
                  ) : null}
                </View>
                <Text variant="body">{paymentSentence(payment.kind)}</Text>
                <Button
                  label={paymentActionLabel(payment)}
                  loading={payingKey === key}
                  disabled={busy}
                  onPress={() => onPay(item)}
                />
              </Card>
            );
          })}
        </View>
      ) : null}
    </>
  );
}

function CreditSection({ credit, onRetry }: { credit: LoadState<VenueCredit[]>; onRetry: () => void }) {
  return (
    <View style={styles.section}>
      <SectionHeader title="Your credit" />
      {credit.status === 'loading' ? <SkeletonBlock width="100%" height={72} /> : null}
      {credit.status === 'error' ? (
        <EmptyState icon="exclamationmark.circle.fill" message={credit.message} action={{ label: 'Try again', onPress: onRetry }} />
      ) : null}
      {credit.status === 'ready' && credit.data.length === 0 ? (
        <Text variant="body" tone="inkMuted">
          No credit right now.
        </Text>
      ) : null}
      {credit.status === 'ready' && credit.data.length > 0 ? (
        <>
          <Text variant="callout" tone="inkMuted">
            Credit can only be spent at the venue that gave it, and can’t be cashed out.
          </Text>
          {credit.data.map((venue) => (
            <Card key={venue.venue_id} testID={`credit-${venue.venue_id}`} style={styles.card}>
              <View style={styles.titleRow}>
                <Text variant="headline" style={styles.titleText}>
                  {venue.venue_name}
                </Text>
                <Text variant="headline" tabular>
                  {formatEuros(venue.available_cents)}
                </Text>
              </View>
              {venue.credits.map((c) => (
                <View key={c.credit_id} style={styles.titleRow}>
                  <Text variant="callout" tone="inkMuted" tabular style={styles.titleText}>
                    {expiryLabel(c.expires_at)}
                  </Text>
                  <Text variant="callout" tabular>
                    {formatEuros(c.remaining_cents)}
                  </Text>
                </View>
              ))}
            </Card>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
  card: { gap: space.md },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  titleText: { flex: 1, gap: space.xs },
});
