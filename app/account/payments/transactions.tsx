import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconLabel } from '@/components/icon-label';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
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

const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid',
  pending: 'Awaiting payment',
  refunded: 'Refunded (booking cancelled)',
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
 *  place instead of being re-derived here. */
export default function TransactionsScreen() {
  const venuesState = useVenues();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
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
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {!transactions && !error ? <ActivityIndicator /> : null}
        {error ? <ThemedText style={styles.note}>Could not load: {error}</ThemedText> : null}
        {transactions && transactions.length === 0 ? (
          <IconLabel icon="doc.text.fill" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
            No booking payments yet.
          </IconLabel>
        ) : null}
        {transactions?.map((tx) => (
          <ThemedView key={tx.id} style={[styles.card, { borderColor: border }]}>
            <View style={styles.rowMain}>
              <ThemedText type="defaultSemiBold" style={styles.venue}>
                {venueName(tx.venue_id)}
                {tx.is_booker ? ' (your booking)' : ''}
              </ThemedText>
              <ThemedText style={styles.amount}>€{(tx.amount_cents / 100).toFixed(2)}</ThemedText>
            </View>
            <ThemedText style={styles.meta}>
              {tx.booking_day} · {tx.start_time.slice(0, 5)} · {tx.format} · {STATUS_LABEL[tx.status] ?? tx.status}
            </ThemedText>

            {tx.status === 'pending' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/booking-payment', params: { bookingId: tx.booking_id } })}
                style={styles.finishRow}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <ThemedText type="link" style={styles.finishText}>
                  Finish payment
                </ThemedText>
                <IconSymbol name="arrow.right" size={12} color={FuttyColors.emerald700} />
              </Pressable>
            ) : null}
          </ThemedView>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 10,
    padding: 16,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  rowMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  venue: {
    fontSize: 14,
  },
  amount: {
    fontFamily: FuttyFonts.monoSemiBold,
    fontSize: 14,
    color: FuttyColors.stone900,
  },
  meta: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
  finishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  finishText: {
    fontSize: 13,
  },
});
