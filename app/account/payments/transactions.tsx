import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useVenues } from '@/lib/use-venues';

type ShareTransaction = {
  id: string;
  booking_id: string;
  amount_cents: number;
  status: string;
  paid_at: string | null;
  is_booker: boolean;
};

type BookingInfo = {
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
 *  unlike a plain list of venue_bookings you created. */
export default function TransactionsScreen() {
  const { user } = useAuth();
  const venuesState = useVenues();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const [shares, setShares] = useState<ShareTransaction[] | null>(null);
  const [bookings, setBookings] = useState<Record<string, BookingInfo>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    (async () => {
      const { data: shareRows, error: shareError } = await supabase
        .from('booking_payment_shares')
        .select('id, booking_id, amount_cents, status, paid_at, is_booker')
        .eq('profile_id', user.id)
        .order('paid_at', { ascending: false, nullsFirst: false });

      if (shareError) {
        setError(shareError.message);
        return;
      }

      setShares(shareRows ?? []);

      const bookingIds = [...new Set((shareRows ?? []).map((s) => s.booking_id))];
      if (bookingIds.length === 0) return;

      const { data: bookingRows } = await supabase
        .from('venue_bookings')
        .select('id, venue_id, booking_day, start_time, format')
        .in('id', bookingIds);

      const map: Record<string, BookingInfo> = {};
      for (const row of bookingRows ?? []) map[row.id] = row;
      setBookings(map);
    })();
  }, [user]);

  function venueName(venueId: string) {
    return venuesState.status === 'ready'
      ? (venuesState.venues.find((v) => v.id === venueId)?.name ?? 'Venue')
      : 'Venue';
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {!shares && !error ? <ActivityIndicator /> : null}
        {error ? <ThemedText style={styles.note}>Could not load: {error}</ThemedText> : null}
        {shares && shares.length === 0 ? (
          <IconLabel icon="doc.text.fill" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
            No booking payments yet.
          </IconLabel>
        ) : null}
        {shares?.map((share) => {
          const booking = bookings[share.booking_id];
          return (
            <ThemedView key={share.id} style={[styles.card, { borderColor: border }]}>
              <View style={styles.rowMain}>
                <ThemedText type="defaultSemiBold" style={styles.venue}>
                  {booking ? venueName(booking.venue_id) : 'Venue'}
                  {share.is_booker ? ' (your booking)' : ''}
                </ThemedText>
                <ThemedText style={styles.amount}>€{(share.amount_cents / 100).toFixed(2)}</ThemedText>
              </View>
              <ThemedText style={styles.meta}>
                {booking ? `${booking.booking_day} · ${booking.start_time.slice(0, 5)} · ${booking.format} · ` : ''}
                {STATUS_LABEL[share.status] ?? share.status}
              </ThemedText>
            </ThemedView>
          );
        })}
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
    color: FuttyColors.emerald950,
  },
  meta: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
});
