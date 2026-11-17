// The venue dashboard's Credits list (P6d; docs/specs/13-payments-bookings.md
// "Venue credit"): each player's credit they can still spend at this venue,
// as venue_credit_list returned it, and each credit's amount left and its
// expiry as a Cyprus date. By name only.
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Banner, Card, EmptyState, SkeletonBlock, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { useLoad } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import { cyprusDateOf, describeMoneyError, fetchCredits, formatDay, type CreditListItem } from '@/lib/venue-money';

export function CreditsView({ venueId }: { venueId: string }) {
  const load = useCallback(async () => {
    const { data, error } = await fetchCredits(venueId);
    if (error || !data) throw new Error(describeMoneyError(error?.message ?? ''));
    return data as CreditListItem[];
  }, [venueId]);
  const { state, reload } = useLoad(venueId, load);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text variant="callout" tone="inkMuted">
        Credit can only be spent at your venue and can&apos;t be cashed out. It expires on the date shown.
      </Text>
      {state.status === 'loading' ? <SkeletonBlock width="100%" height={space.xxl * 8} /> : null}
      {state.status === 'error' ? (
        <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: reload }} />
      ) : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <EmptyState icon="creditcard.fill" message="No player has credit at your venue." />
      ) : null}
      {state.status === 'ready'
        ? state.data.map((p) => (
            <Card key={p.profile_id} testID={`credit-${p.profile_id}`}>
              <View style={styles.head}>
                <Text variant="headline" style={styles.name}>
                  {p.name}
                </Text>
                <Text variant="headline" tabular>
                  {formatEuros(p.available_cents)}
                </Text>
              </View>
              {p.credits.map((c) => (
                <Text key={c.credit_id} variant="callout" tone="inkMuted" tabular testID={`credit-${c.credit_id}`}>
                  {`${formatEuros(c.remaining_cents)} · expires ${formatDay(cyprusDateOf(c.expires_at))}`}
                </Text>
              ))}
            </Card>
          ))
        : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginBottom: space.xs },
  name: { flex: 1 },
});
