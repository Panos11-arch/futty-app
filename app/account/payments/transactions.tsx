import { router } from 'expo-router';
import { Fragment, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonText } from '@/components/ui/skeleton';
import { StatusPill, type Status } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { colors, hairline, space } from '@/constants/futty-theme';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';
import { useVenues } from '@/lib/use-venues';

type Transaction = {
  id: string;
  booking_id: string;
  amount_cents: number;
  status: string;
  paid_at: string | null;
  is_booker: boolean;
  venue_id: string;
  booking_day: string;
  start_time: string;
  format: string;
};

/** Each share state as a StatusPill. A state with no pill keeps its words. */
const STATUS_PILL: Record<string, Status> = {
  paid: 'paid',
  pending: 'pending',
  refunded: 'refunded',
};

/** Words shown next to the pill, or in place of one (no pill for cancelled). */
const STATUS_NOTE: Record<string, string> = {
  pending: 'Awaiting payment',
  refunded: 'Booking cancelled',
  cancelled: 'Cancelled',
};

/** What the signed-in user themselves has paid or owes — one row per
 *  booking_payment_shares row that's theirs, whether they booked it or just
 *  joined it (see supabase/booking-payment-splits.sql). This is genuinely
 *  "your" transactions now that a booking's total is split across players,
 *  unlike a plain list of venue_bookings you created.
 *
 *  Fetched via list_my_transactions() (supabase/transactions-list.sql)
 *  rather than a client-side join+filter: it already excludes expired
 *  'pending' shares (kickoff passed, display-layer safeguard alongside the
 *  real cancel-unpaid-bookings cleanup) while always returning every paid/
 *  refunded/cancelled share regardless of age — filtering that lives in one
 *  place instead of being re-derived here.
 *
 *  Amounts are the server's integer cents, formatted only (right-aligned,
 *  tabular figures). */
export default function TransactionsScreen() {
  const venuesState = useVenues();
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('list_my_transactions').then(({ data, error: fetchError }) => {
      if (fetchError) setError(fetchError.message);
      else setTransactions((data ?? []) as Transaction[]);
    });
  }, []);

  function venueName(venueId: string) {
    return venuesState.status === 'ready'
      ? (venuesState.venues.find((v) => v.id === venueId)?.name ?? 'Venue')
      : 'Venue';
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {!transactions && !error ? (
          <Card testID="transactions-skeleton">
            <SkeletonText lines={4} />
          </Card>
        ) : null}
        {error ? <Banner tone="danger" message={`Could not load: ${error}`} /> : null}
        {transactions && transactions.length === 0 ? (
          <EmptyState icon="doc.text.fill" message="No booking payments yet." />
        ) : null}
        {transactions && transactions.length > 0 ? (
          <Card padded={false}>
            {transactions.map((tx, i) => {
              const pill = STATUS_PILL[tx.status];
              return (
                <Fragment key={tx.id}>
                  {i > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.row} testID="transaction">
                    <View style={styles.rowMain}>
                      <Text variant="body" style={styles.flex}>
                        {venueName(tx.venue_id)}
                        {tx.is_booker ? ' (your booking)' : ''}
                      </Text>
                      <Text variant="headline" tabular style={styles.amount}>
                        {formatEuros(tx.amount_cents)}
                      </Text>
                    </View>
                    <View style={styles.rowMain}>
                      <Text variant="callout" tone="inkMuted" tabular style={styles.flex}>
                        {tx.booking_day} · {tx.start_time.slice(0, 5)} · {tx.format}
                        {STATUS_NOTE[tx.status] ? ` · ${STATUS_NOTE[tx.status]}` : pill ? '' : ` · ${tx.status}`}
                      </Text>
                      {pill ? <StatusPill status={pill} /> : null}
                    </View>

                    {tx.status === 'pending' ? (
                      <Button
                        label="Finish payment"
                        variant="plain"
                        onPress={() => router.push({ pathname: '/booking-payment', params: { bookingId: tx.booking_id } })}
                      />
                    ) : null}
                  </View>
                </Fragment>
              );
            })}
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
  row: { gap: space.xs, paddingHorizontal: space.lg, paddingVertical: space.md },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  amount: { textAlign: 'right' },
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
});
