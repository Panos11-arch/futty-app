import { usePaymentSheet } from '@stripe/stripe-react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAuth } from '@/lib/auth';
import { addBookingPlayer, createSharePayment, listBookingShares, type BookingShare } from '@/lib/booking-shares';
import { describeFunctionError } from '@/lib/edge-functions';
import { supabase } from '@/lib/supabase';

function centsToLabel(cents: number) {
  return `€${(cents / 100).toFixed(2)}`;
}

const STATUS_ICON: Record<BookingShare['status'], React.ComponentProps<typeof IconSymbol>['name']> = {
  pending: 'clock.fill',
  paid: 'checkmark.circle.fill',
  refunded: 'exclamationmark.triangle.fill',
  cancelled: 'xmark',
};

/** Shown right after a priced booking is created, replacing the old
 *  "pay the full amount now" screen — the booker pays their own share here
 *  (which is what actually reserves the pitch), other players show as
 *  pending until they each pay their own via their own device. */
export default function BookingPaymentScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { user } = useAuth();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();

  const [shares, setShares] = useState<BookingShare[] | null>(null);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payingShareId, setPayingShareId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!bookingId) return;
    const [{ data: shareRows, error: shareError }, { data: booking }] = await Promise.all([
      listBookingShares(bookingId),
      supabase.from('venue_bookings').select('status').eq('id', bookingId).maybeSingle(),
    ]);
    if (shareError) setError(shareError.message);
    else setShares(shareRows ?? []);
    if (booking) setBookingStatus(booking.status);
  }, [bookingId]);

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const myShare = shares?.find((s) => s.profile_id === user?.id) ?? null;
  const isBooker = myShare?.is_booker ?? false;

  async function payShare(share: BookingShare) {
    setPayingShareId(share.id);
    setError(null);

    const { data, error: createError } = await createSharePayment(share.id);
    if (createError || !data?.clientSecret) {
      setPayingShareId(null);
      setError(createError ? await describeFunctionError(createError) : "Couldn't start payment — try again.");
      return;
    }

    const { error: initError } = await initPaymentSheet({
      merchantDisplayName: 'Futty',
      paymentIntentClientSecret: data.clientSecret,
    });
    if (initError) {
      setPayingShareId(null);
      setError(initError.message);
      return;
    }

    const { error: presentError } = await presentPaymentSheet();
    setPayingShareId(null);

    if (presentError) {
      if (presentError.code !== 'Canceled') setError(presentError.message);
      return;
    }

    // Flips to 'paid' via stripe-webhook, not this client call — reload()
    // will show 'pending' for a brief moment until that webhook lands, same
    // trust model as every other payment in this app.
    load();
  }

  async function addPlayer() {
    if (!bookingId || !username.trim() || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    const { error: addPlayerError } = await addBookingPlayer(bookingId, username.trim());
    setAddBusy(false);
    if (addPlayerError) {
      setAddError(addPlayerError.message.includes('player_not_found') ? 'No player with that username.' : addPlayerError.message);
    } else {
      setUsername('');
      load();
    }
  }

  if (!shares) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconLabel icon="creditcard.fill" type="subtitle">
          Split payment
        </IconLabel>

        {bookingStatus === 'confirmed' ? (
          <IconLabel icon="checkmark.circle.fill" iconColor={FuttyColors.emerald700} style={styles.note}>
            Pitch reserved — your share is paid.
          </IconLabel>
        ) : (
          <ThemedText style={styles.note}>
            The pitch is reserved once your own share is paid. Everyone else pays their own share
            independently.
          </ThemedText>
        )}

        {shares.map((share) => (
          <ThemedView key={share.id} style={[styles.shareCard, { borderColor: border }]}>
            <View style={styles.shareRow}>
              <IconSymbol
                name={STATUS_ICON[share.status]}
                size={16}
                color={share.status === 'paid' ? FuttyColors.emerald700 : FuttyColors.stone400}
              />
              <View style={styles.shareText}>
                <ThemedText type="defaultSemiBold" style={styles.shareName}>
                  {share.profile_id === user?.id ? 'You' : (share.username ?? 'Player')}
                  {share.is_booker ? ' · Booker' : ''}
                </ThemedText>
                <ThemedText style={styles.shareStatus}>
                  {share.status === 'paid' ? 'Paid' : share.status === 'pending' ? 'Awaiting payment' : share.status}
                </ThemedText>
              </View>
              <ThemedText style={styles.shareAmount}>{centsToLabel(share.amount_cents)}</ThemedText>
            </View>

            {share.profile_id === user?.id && share.status === 'pending' ? (
              <AuthButton label="Pay your share" onPress={() => payShare(share)} busy={payingShareId === share.id} />
            ) : null}
          </ThemedView>
        ))}

        {error ? <AuthError>{error}</AuthError> : null}

        {isBooker ? (
          <View style={styles.addPlayerSection}>
            <ThemedText style={styles.label}>Add a player manually</ThemedText>
            <View style={styles.addPlayerRow}>
              <AuthField
                value={username}
                onChangeText={setUsername}
                placeholder="Their username"
                autoCapitalize="none"
                style={styles.addPlayerField}
              />
              <AuthButton label="Add" onPress={addPlayer} busy={addBusy} disabled={!username.trim()} />
            </View>
            {addError ? <AuthError>{addError}</AuthError> : null}
            <ThemedText style={styles.hint}>
              Players who join via a &quot;need players&quot; post linked to this booking are added
              automatically.
            </ThemedText>
          </View>
        ) : null}

        <AuthButton label="Done" variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: 12,
    padding: 16,
    paddingBottom: 48,
  },
  note: {
    fontSize: 12,
    opacity: 0.8,
  },
  shareCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  shareText: {
    flex: 1,
    gap: 1,
  },
  shareName: {
    fontSize: 14,
  },
  shareStatus: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
  shareAmount: {
    fontFamily: FuttyFonts.monoSemiBold,
    fontSize: 14,
    color: FuttyColors.emerald950,
  },
  addPlayerSection: {
    gap: 8,
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: FuttyColors.stone200,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: FuttyColors.emerald950,
  },
  addPlayerRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  addPlayerField: {
    flex: 1,
  },
  hint: {
    fontSize: 11,
    opacity: 0.6,
  },
});
