// Checkout (spec 15 section 5; spec 13 "Booking modes", "Cash at the
// venue", "Venue credit"). Every amount is booking_quote's, shown as it is:
// the two prices, the breakdown, the total. The player only chooses.
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  CancellationRules,
  cashSentence,
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
  SegmentedControl,
  SkeletonBlock,
  SkeletonText,
  StickyActionBar,
  Text,
} from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import type { PaymentMode } from '@/lib/booking-actions';
import type { PayOptions } from '@/lib/booking-checkout';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { gipedoModeSentence } from '@/lib/booking-gipedo';
import {
  checkoutAmounts,
  cyprusDateLabel,
  showNonRefundable,
  slotLabel,
  useNow,
  type BookingQuote,
  type LoadState,
} from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';

export type CheckoutViewProps = {
  venueName: string;
  quote: LoadState<BookingQuote>;
  onRetry: () => void;
  onPay: (choice: { mode: PaymentMode; teamId?: string; pay: PayOptions }) => void;
  paying: boolean;
  error: string | null;
  /** Opens "Pay what I owe" from the debt line. */
  onPayOwed?: () => void;
  /** A booking is already held for this checkout, so who pays is fixed. */
  bookingHeld: boolean;
  /** For tests; the screen uses the clock. */
  now?: Date;
};

type Who = 'pay_all' | 'each_pays' | 'gipedo_pano';
type Each = 'each_pays_responsible' | 'each_pays_own_spot';

// Spec 13, "Booking modes": who pays, and who covers a spot nobody paid.
const MODE_SENTENCES: Record<Exclude<Who, 'gipedo_pano'> | Each, string> = {
  pay_all: 'You pay for the whole pitch in one payment.',
  each_pays: 'Each player pays their own share, by card or cash.',
  each_pays_responsible:
    "I'm responsible for the team: each player pays their own share. Any spot still unpaid is taken from your guarantee hold 2 hours after the match.",
  each_pays_own_spot:
    "Just my spot: each player pays their own share. A player who doesn't pay owes the venue themselves.",
};

// Spec 13, "When money is held and taken" rule 5: an unpaid booking is
// released after 15 minutes.
export const HELD_LINE =
  "Who pays is fixed once payment starts. If you don't finish paying, the booking is released after 15 minutes.";

export function CheckoutView(props: CheckoutViewProps) {
  const { quote } = props;
  if (quote.status === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <SkeletonText lines={2} variant="headline" />
          <SkeletonBlock width="100%" height={48} rounded="control" />
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
  return <CheckoutReady {...props} quote={quote.data} />;
}

function CheckoutReady({
  venueName,
  quote,
  onPay,
  paying,
  error,
  onPayOwed,
  bookingHeld,
  now: nowOverride,
}: Omit<CheckoutViewProps, 'quote' | 'onRetry'> & { quote: BookingQuote }) {
  const clock = useNow();
  const now = nowOverride ?? clock;

  const [who, setWho] = useState<Who | null>(null);
  const [each, setEach] = useState<Each | null>(null);
  const [credit, setCredit] = useState(false);
  const [cash, setCash] = useState(false);
  const [accepted, setAccepted] = useState(false);

  // Gipedo Pano (P8): offered only to a captain, for one of their teams; the
  // server says whether this slot allows it. Card only.
  const teams = quote.captain_teams;
  const [team, setTeam] = useState<string | null>(teams.length === 1 ? teams[0].id : null);
  const gipedo = who === 'gipedo_pano';
  const gipedoBlocked = gipedo && !quote.gipedo_pano.available;

  const mode: PaymentMode | null =
    who === 'pay_all' ? 'pay_all' : who === 'each_pays' ? each : gipedo && !gipedoBlocked ? 'gipedo_pano' : null;
  const creditSplit =
    mode === 'pay_all' ? quote.pay_all.with_credit : mode && !gipedo ? quote.each_pays.mine.with_credit : null;
  const creditOn = credit && creditSplit !== null;
  // Cash only in the each-pays modes, where the server allows it, never with credit.
  const cashOffered = who === 'each_pays' && quote.cash_allowed && !creditOn;
  const cashOn = cash && cashOffered;
  const amounts = checkoutAmounts(quote, { mode, cash: cashOn, credit: creditOn });
  const nonRefundable = showNonRefundable(quote, now);
  const totalLabel = amounts && (amounts.cashCents !== null || creditOn) ? 'By card now' : 'Total';

  const canPay =
    mode !== null && amounts !== null && !quote.in_debt && (!nonRefundable || accepted) && !paying && (!gipedo || team !== null);
  const actionLabel = amounts ? (gipedo ? `Hold ${formatEuros(amounts.totalCents)}` : payLabel(amounts.totalCents)) : 'Choose who pays';

  const choose = <T,>(set: (v: T) => void) => (v: T) => {
    if (!bookingHeld) set(v);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">
            {venueName}
          </Text>
          <Text variant="body" tone="inkMuted" tabular>
            {slotLabel(quote.day, quote.start_time, quote.end_time)}
          </Text>
          <Text variant="body" tone="inkMuted">
            {`${quote.format} · ${quote.players_per_side} v ${quote.players_per_side}`}
          </Text>
        </View>

        {quote.in_debt ? <Banner tone="danger" message={DEBT_LINE} action={payOwedAction(onPayOwed)} /> : null}

        <View style={styles.section}>
          <SectionHeader title="Who pays" />
          <SegmentedControl<Who>
            accessibilityLabel="Who pays"
            options={[
              { value: 'pay_all', label: `Pay for everyone: ${formatEuros(quote.pay_all.card_cents)}` },
              { value: 'each_pays', label: `Each pays: ${formatEuros(quote.each_pays.player_cents)} each` },
              ...(teams.length > 0
                ? [{ value: 'gipedo_pano' as const, label: `Gipedo Pano: ${formatEuros(quote.gipedo_pano.hold_cents)} held` }]
                : []),
            ]}
            value={(who ?? '') as Who}
            onChange={choose(setWho)}
          />
          {who && who !== 'gipedo_pano' ? (
            <Text variant="callout" tone="inkMuted">
              {MODE_SENTENCES[who]}
            </Text>
          ) : null}
          {gipedo ? (
            <>
              <Text variant="callout" tone="inkMuted">
                {gipedoModeSentence(quote.gipedo_pano.hold_cents)}
              </Text>
              {gipedoBlocked && quote.gipedo_pano.unavailable_reason ? (
                <Banner tone="warning" message={describeBookingErrorMessage(quote.gipedo_pano.unavailable_reason)} />
              ) : teams.length === 1 ? (
                <Text variant="callout">{`For ${teams[0].name}`}</Text>
              ) : (
                <SegmentedControl<string>
                  accessibilityLabel="Your team"
                  options={teams.map((t) => ({ value: t.id, label: t.name }))}
                  value={team ?? ''}
                  onChange={choose(setTeam)}
                />
              )}
            </>
          ) : null}
          {who === 'each_pays' ? (
            <>
              <SegmentedControl<Each>
                accessibilityLabel="Who covers an unpaid spot"
                options={[
                  { value: 'each_pays_responsible', label: "I'm responsible for the team" },
                  { value: 'each_pays_own_spot', label: 'Just my spot' },
                ]}
                value={(each ?? '') as Each}
                onChange={choose(setEach)}
              />
              <Text variant="callout" tone="inkMuted">
                {MODE_SENTENCES.each_pays_responsible}
              </Text>
              <Text variant="callout" tone="inkMuted">
                {MODE_SENTENCES.each_pays_own_spot}
              </Text>
            </>
          ) : null}
          {bookingHeld ? (
            <Text variant="callout" tone="inkMuted">
              {HELD_LINE}
            </Text>
          ) : null}
        </View>

        {amounts ? (
          <View style={styles.section}>
            <SectionHeader title="Price" />
            {creditSplit && quote.credit.available_cents > 0 ? (
              <View style={styles.option}>
                <Chip
                  label={`Use my ${formatEuros(quote.credit.available_cents)} credit`}
                  selected={creditOn}
                  onPress={() => setCredit((c) => !c)}
                />
                {quote.credit.expires_at ? (
                  <Text variant="caption" tone="inkMuted">
                    {`Credit at this venue. The first of it expires on ${cyprusDateLabel(quote.credit.expires_at)}.`}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {cashOffered ? (
              <Chip label="Pay the pitch in cash at the venue" selected={cashOn} onPress={() => setCash((c) => !c)} />
            ) : null}
            <PriceBreakdown lines={amounts.lines} totalCents={amounts.totalCents} totalLabel={totalLabel} />
            {amounts.cashCents !== null ? (
              <Text variant="callout">{cashSentence(amounts.totalCents, amounts.cashCents)}</Text>
            ) : null}
          </View>
        ) : null}

        {nonRefundable ? (
          <NonRefundableNotice terms={quote.cancellation} accepted={accepted} onToggle={() => setAccepted((a) => !a)} />
        ) : null}

        <CancellationRules terms={quote.cancellation} />

        {error ? <Banner tone="danger" message={error} /> : null}
      </ScrollView>
      <StickyActionBar
        totalCents={amounts?.totalCents}
        totalLabel={totalLabel}
        actionLabel={actionLabel}
        loading={paying}
        disabled={!canPay}
        onPress={() => {
          if (!canPay || !mode) return;
          const pay = { method: cashOn ? ('cash' as const) : ('card' as const), acceptNonRefundable: nonRefundable && accepted, useCredit: creditOn };
          onPay(gipedo && team ? { mode, teamId: team, pay } : { mode, pay });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
  option: { gap: space.xs },
});
