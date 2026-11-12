// A booking's detail (P5b; spec 15 section 5, spec 13 "Booking screens").
// The screen wires booking_detail, cancellation_quote, cancel-booking,
// invites, the calendar, maps and share to BookingDetailView. Every amount
// is the server's; the app sends only ids, the scope and the quote it showed.
import { useStripe } from '@stripe/stripe-react-native';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Share } from 'react-native';

import { BookingDetailView, type ConfirmResult, type DetailCancelScope, type QuoteResult } from '@/components/booking/booking-detail-view';
import { SquadNeed } from '@/components/booking/squad-need';
import { Sheet } from '@/components/ui';
import { cancelBooking, getCancellationQuote, type CancellationQuote, type CancelResult } from '@/lib/booking-actions';
import {
  addDetailToCalendar,
  calendarMessage,
  cancelledMessage,
  fetchBookingDetail,
  shareText,
  syncDetailInCalendar,
} from '@/lib/booking-detail';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { useLoad } from '@/lib/booking-search';
import { addBookingPlayer } from '@/lib/booking-shares';
import { isBookingInCalendar, removeBookingFromCalendar } from '@/lib/calendar';
import { describeFunctionError } from '@/lib/edge-functions';
import { appleMapsUrl, googleMapsUrl } from '@/lib/venue-page';

export default function BookingDetailScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => fetchBookingDetail(id), [id]);
  const { state, reload } = useLoad(id || null, load);
  const { handleNextAction } = useStripe();
  const [notice, setNotice] = useState<string | null>(null);
  const [inCalendar, setInCalendar] = useState(() => (id ? isBookingInCalendar(id) : false));
  const [choosingMaps, setChoosingMaps] = useState(false);
  const detail = state.status === 'ready' ? state.data : null;

  // Keep the calendar event in line with the booking (lib/calendar asks the
  // booking screens to): updated when it changes, removed once cancelled.
  useEffect(() => {
    if (!detail) return;
    void syncDetailInCalendar(detail)
      .then(() => setInCalendar(isBookingInCalendar(detail.booking.id)))
      .catch(() => {});
  }, [detail]);

  async function quote(scope: DetailCancelScope): Promise<QuoteResult> {
    const { data, error } = await getCancellationQuote(id, scope);
    if (error || !data) return { error: describeBookingErrorMessage(error?.message ?? 'Something went wrong.') };
    return { quote: data as CancellationQuote };
  }

  /** The booker's €1-per-player charge may need 3-D Secure; the booking is
   *  cancelled either way (spec 13). */
  async function finishFee(result: CancelResult): Promise<CancelResult> {
    const fee = result.fee;
    if (fee?.status !== 'requires_action' || !fee.clientSecret) return result;
    const { error } = await handleNextAction(fee.clientSecret);
    return { ...result, fee: { ...fee, status: error ? 'failed' : 'processing' } };
  }

  async function confirmCancel({ scope, quote: shown }: { scope: DetailCancelScope; quote: string | null }): Promise<ConfirmResult> {
    const { data, error } = await cancelBooking(id, shown ? { scope, quote: shown } : undefined);
    if (error || !data) {
      const code = error ? await describeFunctionError(error) : 'Something went wrong.';
      if (code === 'quote_changed') {
        const again = await quote(scope);
        if ('quote' in again) return { status: 'changed', quote: again.quote };
        return { status: 'error', message: again.error };
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return { status: 'error', message: describeBookingErrorMessage(code) };
    }
    const result = await finishFee(data);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Left the game: take it off the calendar. A cancelled booking is
    // removed by the sync after the reload.
    if (scope === 'my_spot') void removeBookingFromCalendar(id).catch(() => {});
    setNotice(cancelledMessage(scope, result));
    reload();
    return { status: 'cancelled' };
  }

  async function invite(username: string): Promise<string | null> {
    const { error } = await addBookingPlayer(id, username);
    return error ? describeBookingErrorMessage(error.message) : null;
  }

  async function addToCalendar() {
    if (!detail) return;
    try {
      const result = await addDetailToCalendar(detail);
      setNotice(calendarMessage(result));
      setInCalendar(isBookingInCalendar(id));
    } catch {
      setNotice(calendarMessage('unavailable'));
    }
  }

  function share() {
    if (detail) void Share.share({ message: shareText(detail) }).catch(() => {});
  }

  function directions() {
    if (!detail) return;
    // Android has no Apple Maps: straight to Google Maps.
    if (Platform.OS === 'ios') setChoosingMaps(true);
    else void Linking.openURL(googleMapsUrl(detail.venue));
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Booking' }} />
      <BookingDetailView
        state={id ? state : { status: 'error', message: 'This booking could not be found.' }}
        onRetry={reload}
        onRefresh={reload}
        onQuote={quote}
        onConfirmCancel={confirmCancel}
        onInvite={invite}
        onShare={share}
        onAddToCalendar={addToCalendar}
        inCalendar={inCalendar}
        onDirections={directions}
        onPayShare={() => router.push({ pathname: '/booking-payment', params: { bookingId: id } })}
        notice={notice}
        squadNeed={
          detail ? (
            <SquadNeed
              booking={{
                id: detail.booking.id,
                venueId: detail.venue.id,
                kickoffAt: detail.booking.kickoff_at,
                format: detail.booking.format,
                openSpots: detail.booking.capacity - detail.roster.length,
              }}
            />
          ) : null
        }
      />
      <Sheet
        visible={choosingMaps}
        onClose={() => setChoosingMaps(false)}
        title="Directions"
        primaryAction={{
          label: 'Open in Apple Maps',
          onPress: () => {
            setChoosingMaps(false);
            if (detail) void Linking.openURL(appleMapsUrl(detail.venue));
          },
        }}
        secondaryAction={{ label: 'Open in Google Maps', onPress: () => detail && void Linking.openURL(googleMapsUrl(detail.venue)) }}
      />
    </>
  );
}
