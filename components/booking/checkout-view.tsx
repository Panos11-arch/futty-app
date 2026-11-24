// Checkout, Booking v2 (B2; spec 13 "Booking modes (Booking v2)", "How each
// side pays"; spec 15 Words rules; the agreed 04-payment-sheet design). The
// pitch list, whole or half pitch, the ways to pay, cash, credit, the
// cancellation line and Pay. Every amount is the server's (booking_quote_v2,
// venue_free_pitches; credit from booking_quote), shown as it is. The player
// only chooses; the app never sends a price.
import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ChoiceCard, PitchRow } from '@/components/booking/checkout-choice';
import {
  cashSentence,
  checkoutCancellationLines,
  DEBT_LINE,
  NonRefundableNotice,
  payLabel,
  payOwedAction,
} from '@/components/booking/checkout-parts';
import {
  Banner,
  Chip,
  EmptyState,
  PriceBreakdown,
  SectionHeader,
  Sheet,
  SkeletonBlock,
  SkeletonText,
  StickyActionBar,
  Text,
} from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import { timeToMin } from '@/lib/booking';
import type { PaymentMode } from '@/lib/booking-actions';
import type { PayOptions } from '@/lib/booking-checkout';
import { cyprusDateLabel, showNonRefundable, useNow, type LoadState } from '@/lib/booking-search';
import {
  cashOffered,
  checkoutAmountsV2,
  checkoutCancellationLine,
  creditOffered,
  guaranteeCents,
  guaranteeLine,
  KIND_LINES,
  losersPayLine,
  losersPayOffered,
  modeForWay,
  pitchDetails,
  wayLine,
  wayPriceLabel,
  type BookingKind,
  type CheckoutData,
  type FreePitch,
  type WayToPay,
} from '@/lib/booking-v2';
import { formatEuros } from '@/lib/money/format';
import { minutesText, ruleText } from '@/lib/rules';

export type CheckoutPayChoice = {
  mode: PaymentMode;
  kind: BookingKind;
  pitchIds: string[];
  pay: PayOptions;
  /** B1d: Losers pay on a half pitch. */
  losersPay?: boolean;
};

export type CheckoutViewProps = {
  venueName: string;
  quote: LoadState<CheckoutData>;
  /** venue_free_pitches for the slot; reloaded when a pitch is taken. */
  pitches: LoadState<FreePitch[]>;
  onRetry: () => void;
  onPay: (choice: CheckoutPayChoice) => void;
  paying: boolean;
  error: string | null;
  /** Opens "Pay what I owe" from the debt line. */
  onPayOwed?: () => void;
  /** A booking is already held for this checkout, so the choices are fixed. */
  bookingHeld: boolean;
  /** For tests; the screen uses the clock. */
  now?: Date;
  /** The weather strip for the game's hours (P11). Nothing renders until one is passed in. */
  weather?: ReactNode;
};

/** "Thu 26 Nov · 20:00" (a Cyprus calendar day, read as such). */
export function dayTimeLabel(day: string, start: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return `${date.replace(',', '')} · ${start.slice(0, 5)}`;
}

// Spec 13, "When money is held and taken" rule 5: an unpaid booking is
// released when the payment window (app_rules.payment_window_minutes) ends.
export function heldLine(): string {
  return ruleText(
    (r) => `Your choices are fixed. Finish paying within ${minutesText(r.payment_window_minutes)} of booking.`,
    'Your choices are fixed. Finish paying soon, or the booking is released.',
  );
}

const WAYS: { way: WayToPay; title: string; testID: string }[] = [
  // These testIDs are the ones .maestro/flows have always used.
  { way: 'pay_all', title: 'Pay for everyone', testID: 'checkout-who-pay-all' },
  { way: 'pay_for_myself', title: 'Pay for myself', testID: 'checkout-who-each-pays' },
];

export function CheckoutView(props: CheckoutViewProps) {
  const { quote } = props;
  if (quote.status === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <SkeletonText lines={2} variant="headline" />
          <SkeletonBlock width="100%" height={56} rounded="control" />
          <SkeletonBlock width="100%" height={120} />
        </View>
      </View>
    );
  }
  if (quote.status === 'error') {
    return (
      <View style={styles.screen}>
        <EmptyState icon="exclamationmark.circle.fill" message={quote.message} action={{ label: 'Try again', onPress: props.onRetry }} />
      </View>
    );
  }
  return <CheckoutReady {...props} data={quote.data} />;
}

function CheckoutReady({
  venueName,
  data,
  pitches,
  onRetry,
  onPay,
  paying,
  error,
  onPayOwed,
  bookingHeld,
  now: nowOverride,
  weather,
}: Omit<CheckoutViewProps, 'quote'> & { data: CheckoutData }) {
  const { quote } = data;
  const clock = useNow();
  const now = nowOverride ?? clock;

  const [pitchKey, setPitchKey] = useState<string | null>(null);
  const [kindChoice, setKind] = useState<BookingKind>('whole');
  const [way, setWay] = useState<WayToPay | null>(null);
  const [losersChoice, setLosers] = useState(false);
  const [credit, setCredit] = useState(false);
  const [cash, setCash] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  // The chosen pitch, or the first free one (also when the chosen one was taken).
  const free = pitches.status === 'ready' ? pitches.data : [];
  const pitch = free.find((p) => p.pitch_ids.join(',') === pitchKey) ?? free[0] ?? null;
  // Half only while the server offers it.
  const kind: BookingKind = quote.half.available ? kindChoice : 'whole';

  // B1d: Losers pay, a half pitch only, where the server offers it.
  const losersPay = losersChoice && losersPayOffered(quote, kind);
  const creditOn = credit && !losersPay && creditOffered(data.credit, { kind, way });
  const cashShown = cashOffered(quote, { kind, way }) && !creditOn;
  const cashOn = cash && cashShown;
  const choice = { kind, way, cash: cashOn, credit: creditOn, losersPay };
  const amounts = checkoutAmountsV2(data, choice);
  const guarantee = guaranteeCents(quote, choice);
  const nonRefundable = showNonRefundable(quote, now);
  // QA 24 November, T2: Losers pay takes nothing before the result, so its
  // bar says what's held, not paid.
  const holding = losersPay && kind === 'half';
  const totalLabel = holding
    ? 'Held until the result.'
    : amounts && (amounts.cashCents !== null || creditOn)
      ? 'By card now'
      : 'Total';

  const canPay =
    way !== null && amounts !== null && pitch !== null && !quote.in_debt && (!nonRefundable || accepted) && !paying;
  const actionLabel = amounts ? (holding ? `Hold ${formatEuros(amounts.totalCents)}` : payLabel(amounts.totalCents)) : 'Choose who pays';

  const choose = <T,>(set: (v: T) => void) => (v: T) => {
    if (!bookingHeld) set(v);
  };

  const minutes = timeToMin(quote.end_time) - timeToMin(quote.start_time);
  const subtitle = [venueName, pitch?.label, quote.format, `${minutes} min`].filter(Boolean).join(' · ');

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text variant="title" accessibilityRole="header" tabular>
            {dayTimeLabel(quote.day, quote.start_time)}
          </Text>
          <Text variant="body" tone="inkMuted">
            {subtitle}
          </Text>
        </View>

        {quote.in_debt ? <Banner tone="danger" message={DEBT_LINE} action={payOwedAction(onPayOwed)} /> : null}

        {weather ? <View testID="checkout-weather">{weather}</View> : null}

        <View style={styles.section}>
          <SectionHeader title="Pitch" />
          {pitches.status === 'loading' ? (
            <SkeletonBlock width="100%" height={56} rounded="control" />
          ) : pitches.status === 'error' ? (
            <Banner tone="danger" message={pitches.message} action={{ label: 'Try again', onPress: onRetry }} />
          ) : free.length === 0 ? (
            <View testID="checkout-pitches-empty">
              <Text variant="body" tone="inkMuted">
                No pitch is free at this time. Pick another time.
              </Text>
            </View>
          ) : (
            free.map((p, i) => (
              <PitchRow
                key={p.pitch_ids.join(',')}
                testID={`checkout-pitch-${i + 1}`}
                label={p.label}
                details={pitchDetails(p)}
                price={formatEuros(p.price_cents)}
                selected={p === pitch}
                locked={bookingHeld}
                onPress={() => choose(setPitchKey)(p.pitch_ids.join(','))}
              />
            ))
          )}
        </View>

        <View style={styles.row}>
          <ChoiceCard
            testID="checkout-kind-whole"
            title="Whole pitch"
            line={KIND_LINES.whole}
            selected={kind === 'whole'}
            locked={bookingHeld}
            onPress={() => choose(setKind)('whole')}
          />
          {quote.half.available ? (
            <ChoiceCard
              testID="checkout-kind-half"
              title="Half pitch"
              line={KIND_LINES.half}
              selected={kind === 'half'}
              locked={bookingHeld}
              onPress={() => choose(setKind)('half')}
            />
          ) : null}
        </View>

        {losersPayOffered(quote, kind) ? (
          <View style={styles.option}>
            <View style={styles.switchRow}>
              <Text variant="body" style={styles.switchLabel}>
                Losers pay
              </Text>
              <Switch
                testID="checkout-losers-pay"
                accessibilityLabel="Losers pay"
                value={losersPay}
                disabled={bookingHeld}
                onValueChange={(on) => choose(setLosers)(on)}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={colors.surface}
              />
            </View>
            {losersPay ? (
              <View testID="checkout-losers-pay-line">
                <Text variant="callout" tone="inkMuted">
                  {losersPayLine(quote, way)}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader title="Who pays" />
          <View style={styles.row}>
            {WAYS.map((w) => (
              <ChoiceCard
                key={w.way}
                testID={w.testID}
                title={w.title}
                price={wayPriceLabel(quote, kind, w.way, losersPay)}
                line={wayLine(kind, w.way, losersPay)}
                selected={way === w.way}
                locked={bookingHeld}
                onPress={() => choose(setWay)(w.way)}
              />
            ))}
          </View>
          {guarantee !== null ? (
            <View testID="checkout-guarantee">
              <Text variant="callout" tone="inkMuted">
                {guaranteeLine(guarantee)}
              </Text>
            </View>
          ) : null}
          {cashShown ? (
            <View style={styles.switchRow}>
              <Text variant="body" style={styles.switchLabel}>
                Pay the pitch in cash
              </Text>
              <Switch
                testID="checkout-cash"
                accessibilityLabel="Pay the pitch in cash"
                value={cashOn}
                onValueChange={setCash}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={colors.surface}
              />
            </View>
          ) : null}
          {creditOffered(data.credit, { kind, way }) && !cashOn && !losersPay ? (
            <View style={styles.option}>
              <Chip
                testID="checkout-credit"
                label={`Use my ${formatEuros(data.credit!.available_cents)} credit`}
                selected={creditOn}
                onPress={() => setCredit((c) => !c)}
              />
              {data.credit!.expires_at ? (
                <Text variant="caption" tone="inkMuted">
                  {`Credit at this venue. The first of it expires on ${cyprusDateLabel(data.credit!.expires_at)}.`}
                </Text>
              ) : null}
            </View>
          ) : null}
          {bookingHeld ? (
            <Text variant="callout" tone="inkMuted">
              {heldLine()}
            </Text>
          ) : null}
        </View>

        {amounts ? (
          <View style={styles.section} testID="checkout-price">
            <PriceBreakdown lines={amounts.lines} totalCents={amounts.totalCents} totalLabel={totalLabel} />
            {amounts.cashCents !== null ? (
              <Text variant="callout">{cashSentence(amounts.totalCents, amounts.cashCents)}</Text>
            ) : null}
          </View>
        ) : null}

        {nonRefundable ? (
          <NonRefundableNotice terms={quote.cancellation} accepted={accepted} onToggle={() => setAccepted((a) => !a)} />
        ) : null}

        <View style={styles.cancelRow} testID="checkout-cancellation">
          <Text variant="callout" tone="inkMuted" style={styles.cancelLine}>
            {checkoutCancellationLine(quote.cancellation)}
          </Text>
          <Pressable
            testID="checkout-rules"
            accessibilityRole="link"
            accessibilityLabel="Rules"
            hitSlop={space.md}
            onPress={() => setRulesOpen(true)}>
            <Text variant="callout" tone="brand">
              Rules
            </Text>
          </Pressable>
        </View>

        {error ? (
          <View testID="checkout-error">
            <Banner tone="danger" message={error} />
          </View>
        ) : null}
      </ScrollView>
      <StickyActionBar
        actionTestID="checkout-pay"
        totalCents={amounts?.totalCents}
        totalLabel={totalLabel}
        actionLabel={actionLabel}
        loading={paying}
        disabled={!canPay}
        onPress={() => {
          if (!canPay || !way || !pitch) return;
          onPay({
            mode: modeForWay(way),
            kind,
            pitchIds: pitch.pitch_ids,
            pay: { method: cashOn ? 'cash' : 'card', acceptNonRefundable: nonRefundable && accepted, useCredit: creditOn },
            ...(losersPay ? { losersPay: true } : {}),
          });
        }}
      />
      <Sheet visible={rulesOpen} onClose={() => setRulesOpen(false)} title="Cancelling">
        {checkoutCancellationLines(quote.cancellation).map((line) => (
          <Text key={line} variant="body">
            {line}
          </Text>
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  header: { gap: space.xs },
  section: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md },
  option: { gap: space.xs },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  switchLabel: { flex: 1 },
  cancelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  cancelLine: { flex: 1 },
});
