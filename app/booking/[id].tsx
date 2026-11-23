// A booking's detail (P5b; spec 15 section 5, spec 13 "Booking screens").
// The screen wires booking_detail, cancellation_quote, cancel-booking,
// invites, the calendar, maps and share to BookingDetailView. Every amount
// is the server's; the app sends only ids, the scope and the quote it showed.
import { useStripe } from '@stripe/stripe-react-native';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Share } from 'react-native';

import { BookingDetailView } from '@/components/booking/booking-detail-view';
import { CheckInSection } from '@/components/booking/check-in-panel';
import { SquadNeed } from '@/components/booking/squad-need';
import { Sheet } from '@/components/ui';
import { WeatherStrip } from '@/components/venue/weather-strip';
import { cancelBooking, getCancellationQuote, type CancellationQuote } from '@/lib/booking-actions';
import {
  addDetailToCalendar,
  answerVenuePlayer,
  calendarMessage,
  confirmCancellation,
  fetchBookingDetail,
  removeVenuePlayer,
  shareText,
  spotsTaken,
  syncDetailInCalendar,
  type ConfirmResult,
  type DetailCancelScope,
  type QuoteResult,
} from '@/lib/booking-detail';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { chooseNoOpponent, pullOutOfGipedo } from '@/lib/booking-gipedo';
import { cancelFree, payOtherHalf } from '@/lib/booking-opposition';
import { useLoad } from '@/lib/booking-search';
import { addBookingPlayer } from '@/lib/booking-shares';
import { switchPlayersPerSide } from '@/lib/booking-switch';
import { isBookingInCalendar, removeBookingFromCalendar } from '@/lib/calendar';
import { describeFunctionError } from '@/lib/edge-functions';
import { appleMapsUrl, googleMapsUrl } from '@/lib/venue-page';
import { useRules } from '@/lib/use-rules';
import { useGameWeather } from '@/lib/use-weather';

export default function BookingDetailScreen() {
  // Spec 13's rules for the numbers in this screen's text (P10): loads them
  // and re-renders when they arrive.
  useRules();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => fetchBookingDetail(id), [id]);
  const { state, reload } = useLoad(id || null, load);
  const { handleNextAction, initPaymentSheet, presentPaymentSheet } = useStripe();
  const [notice, setNotice] = useState<string | null>(null);
  const [inCalendar, setInCalendar] = useState(() => (id ? isBookingInCalendar(id) : false));
  const [choosingMaps, setChoosingMaps] = useState(false);
  const detail = state.status === 'ready' ? state.data : null;
  // P11: the forecast for the game's hours.
  const weather = useGameWeather(
    detail?.venue.id,
    detail ? { day: detail.booking.booking_day, start: detail.booking.start_time, end: detail.booking.end_time } : null,
  );

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

  async function confirmCancel(confirmed: { scope: DetailCancelScope; quote: string | null }): Promise<ConfirmResult> {
    const result = await confirmCancellation(id, confirmed, {
      cancel: cancelBooking,
      quote,
      errorCode: describeFunctionError,
      handleNextAction,
      removeFromCalendar: removeBookingFromCalendar,
    });
    if (result.status === 'error') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } else if (result.status === 'cancelled') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setNotice(result.notice ?? null);
      reload();
    }
    return result;
  }

  // Gipedo Pano (P8): the server does it all; the screen reloads after.
  async function gipedoAction(action: () => Promise<string | null>): Promise<string | null> {
    const error = await action();
    if (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      reload();
    }
    return error;
  }

  // P12: the server switches and tells every player; the screen reloads.
  async function switchFormat(to: 5 | 6): Promise<string | null> {
    const error = await switchPlayersPerSide(id, to);
    if (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return error;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setNotice(`Switched to ${to} v ${to}. Every player has been told.`);
    reload();
    return null;
  }

  // P6e: the booker answers a venue's offered player, or removes one; the
  // server tells the venue, and the screen reloads.
  async function venuePlayerAction(action: () => Promise<string | null>): Promise<string | null> {
    const error = await action();
    if (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return error;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    reload();
    return null;
  }

  // B3 (Booking v2): the no-opponent choice. "Pay the whole pitch and play"
  // counts once Stripe's webhook says it's paid; the screen reloads.
  async function payWhole(): Promise<string | null> {
    const outcome = await payOtherHalf(id, { init: (p) => initPaymentSheet(p), present: () => presentPaymentSheet() });
    if (outcome.status === 'error') return gipedoAction(async () => outcome.message);
    if (outcome.status === 'paid') {
      setNotice('Paid. Your game goes ahead on the whole pitch.');
      return gipedoAction(async () => null);
    }
    return null;
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
        onGipedoPullOut={() => gipedoAction(() => pullOutOfGipedo(id))}
        onGipedoChoose={(choice) => gipedoAction(() => chooseNoOpponent(id, choice))}
        onSwitch={switchFormat}
        onAnswerVenuePlayer={(offerId, accept) => venuePlayerAction(() => answerVenuePlayer(offerId, accept))}
        onRemoveVenuePlayer={(offerId) => venuePlayerAction(() => removeVenuePlayer(offerId))}
        onInviteOpposition={() => router.push({ pathname: '/booking-after-pay', params: { bookingId: id } })}
        onPayWhole={payWhole}
        onCancelFree={() => gipedoAction(() => cancelFree(id))}
        weather={<WeatherStrip weather={weather.weather} loading={weather.loading} />}
        checkIn={id ? <CheckInSection bookingId={id} /> : null}
        squadNeed={
          // A Gipedo Pano booking's opposition post is made by the server.
          detail && !detail.gipedo ? (
            <SquadNeed
              booking={{
                id: detail.booking.id,
                venueId: detail.venue.id,
                kickoffAt: detail.booking.kickoff_at,
                format: detail.booking.format,
                // P6e: an accepted venue player takes a spot.
                openSpots: detail.booking.capacity - spotsTaken(detail),
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
