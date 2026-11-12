// Pieces shared by checkout and Pay my share. Every number comes from the
// server; these only put it into words.
import { StyleSheet, View } from 'react-native';

import { Banner, Chip, SectionHeader, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { formatEuros } from '@/lib/money/format';
import { cancellationLines, type CancellationTerms } from '@/lib/venue-page';

/** The cancellation rules in three lines (spec 15, checkout). */
export function CancellationRules({ terms }: { terms: CancellationTerms }) {
  return (
    <View style={styles.section}>
      <SectionHeader title="Cancelling" />
      {cancellationLines(terms).map((line) => (
        <Text key={line} variant="callout" tone="inkMuted">
          {line}
        </Text>
      ))}
    </View>
  );
}

/** Spec 13: kickoff less than 6 hours away, so the payment is taken straight
 *  away and the player must accept the notice before paying. */
export function NonRefundableNotice({
  terms,
  accepted,
  onToggle,
}: {
  terms: CancellationTerms;
  accepted: boolean;
  onToggle: () => void;
}) {
  const hours = terms.refund_cutoff_hours === 1 ? '1 hour' : `${terms.refund_cutoff_hours} hours`;
  return (
    <View style={styles.section}>
      <Banner
        tone="warning"
        title="This booking is non-refundable"
        message={`Kickoff is less than ${hours} away, so you're charged straight away and can't get the money back if you cancel.`}
      />
      <Chip label="I accept that this booking is non-refundable" selected={accepted} onPress={onToggle} />
    </View>
  );
}

/** Who pays what and when, for a cash player (spec 13, "Cash at the venue"). */
export function cashSentence(cardCents: number, cashCents: number): string {
  return cardCents > 0
    ? `You pay the ${formatEuros(cardCents)} service fee by card now and ${formatEuros(cashCents)} in cash at the venue.`
    : `You pay ${formatEuros(cashCents)} in cash at the venue.`;
}

/** "Pay €6.80"; with nothing to charge, the card is only saved. */
export function payLabel(totalCents: number, nothingToCharge = 'Book and save my card'): string {
  return totalCents > 0 ? `Pay ${formatEuros(totalCents)}` : nothingToCharge;
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
});
