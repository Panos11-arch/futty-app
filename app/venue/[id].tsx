// A venue's page (S5; docs/specs/15-design.md section 0.6, images
// 03-venue-book-tab and 04-payment-sheet): venue info and payment on one
// page. Home | Book | Facilities; coming from Book a pitch (tab=book, or the
// time chosen there) it opens on Book. Continue opens Booking v2's payment
// sheet over the page: the same checkout, its rules and its server amounts
// (useSlotCheckout). A venue that isn't live is hidden from players
// (spec 13): the server answers not found to everyone but its owner.
import { usePaymentSheet } from '@stripe/stripe-react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Linking, Platform, Share } from 'react-native';

import { CheckoutView, dayTimeLabel } from '@/components/booking/checkout-view';
import { Sheet } from '@/components/ui';
import { VenuePageView } from '@/components/venue/venue-page-view';
import { WeatherStrip } from '@/components/venue/weather-strip';
import { timeToMin } from '@/lib/booking';
import type { PaymentSheet } from '@/lib/booking-checkout';
import { fetchSearchOptions, useLoad } from '@/lib/booking-search';
import { useDebtBlock } from '@/lib/use-owed';
import { useRules } from '@/lib/use-rules';
import { useSlotCheckout } from '@/lib/use-slot-checkout';
import { useVenuePage } from '@/lib/use-venue-page';
import { useVenueFormats, useVenueSlots } from '@/lib/use-venue-slots';
import { useGameWeather } from '@/lib/use-weather';
import { venueSlot, type BookSelection } from '@/lib/venue-book';
import { fetchVenueHighlights } from '@/lib/venue-highlights';
import { appleMapsUrl, googleMapsUrl, venueShareMessage, venueStartTab, type VenueTab } from '@/lib/venue-page';

type Params = { id: string; tab?: string; day?: string; start?: string; end?: string; format?: string };

const openPayOwed = () => router.push('/account/payments/owed');

/** The game length from Book a pitch's start and end, or an hour. */
function lengthOf(start?: string, end?: string): number {
  if (!start || !end) return 60;
  const minutes = timeToMin(end) - timeToMin(start);
  return minutes > 0 ? minutes : 60;
}

export default function VenueScreen() {
  // Spec 13's rules for the numbers in the payment sheet's text (P10).
  useRules();
  const params = useLocalSearchParams<Params>();
  const { id } = params;
  const [tab, setTab] = useState<VenueTab>(() => venueStartTab(params));
  const { state, reload } = useVenuePage(id);
  const venue = state.status === 'ready' ? state.data.venue : null;
  const [choosingMaps, setChoosingMaps] = useState(false);

  // Home: top players and recent results.
  const loadHighlights = useCallback(() => fetchVenueHighlights(id), [id]);
  const highlights = useLoad(id ? `highlights:${id}` : null, loadHighlights);

  // Book: the account's window, the venue's formats, the day's free times.
  const options = useLoad('options', fetchSearchOptions);
  const formats = useVenueFormats(id ?? null);
  const debt = useDebtBlock();
  const [chosen, setChosen] = useState<Partial<BookSelection>>(() => ({
    day: params.day,
    start: params.start?.slice(0, 5) ?? null,
    minutes: lengthOf(params.start, params.end),
    format: params.format ?? null,
    playersPerSide: 5,
  }));
  const [pitchKey, setPitchKey] = useState<string | null>(null);
  const today = options.state.status === 'ready' ? options.state.data.today : null;
  const firstFormat = formats.status === 'ready' ? (formats.formats[0] ?? null) : null;
  const selection: BookSelection = {
    day: chosen.day ?? today ?? '',
    start: chosen.start ?? null,
    minutes: chosen.minutes ?? 60,
    format: chosen.format ?? firstFormat,
    playersPerSide: chosen.playersPerSide ?? 5,
  };
  const slots = useVenueSlots(id ?? null, selection.day || null, selection.format, selection.minutes, selection.playersPerSide);
  const slotKey = JSON.stringify(selection);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the selection's contents are the key
  const slot = useMemo(() => (id && selection.day ? venueSlot(id, selection) : null), [id, slotKey]);
  const weather = useGameWeather(id, slot ? { day: slot.day, start: slot.start, end: slot.end } : null);

  // The payment sheet: Booking v2's checkout for the chosen slot.
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const stripe: PaymentSheet = useMemo(
    () => ({ init: (p) => initPaymentSheet(p), present: () => presentPaymentSheet() }),
    [initPaymentSheet, presentPaymentSheet],
  );
  const checkout = useSlotCheckout(slot, stripe);
  const [sheetPitch, setSheetPitch] = useState<string | null>(null);

  const openDirections = () => {
    if (!venue) return;
    // Android has no Apple Maps: straight to Google Maps.
    if (Platform.OS === 'ios') setChoosingMaps(true);
    else Linking.openURL(googleMapsUrl(venue));
  };

  return (
    <>
      <Stack.Screen options={{ title: venue?.name ?? 'Venue', headerShown: false }} />
      <VenuePageView
        state={state}
        tab={tab}
        onTabChange={setTab}
        onRetry={reload}
        onBack={() => router.back()}
        onShare={() => {
          if (venue) void Share.share({ message: venueShareMessage(venue) }).catch(() => {});
        }}
        onDirections={openDirections}
        onOpenUrl={(url) => void Linking.openURL(url).catch(() => {})}
        home={{
          highlights: highlights.state,
          onRetry: highlights.reload,
          onPlayer: (profileId) => router.push({ pathname: '/player-profile', params: { profileId } }),
          onTeam: (teamId) => router.push({ pathname: '/team-profile', params: { teamId } }),
        }}
        book={{
          options: options.state,
          formats,
          slots: slots.state,
          pitches: slot ? checkout.pitches : null,
          selection,
          onSelect: (next) => {
            setChosen(next);
            setPitchKey(null);
          },
          pitchKey,
          // A booking already held keeps its pitch until the time changes.
          onPitch: (key) => {
            if (!checkout.bookingHeld) setPitchKey(key);
          },
          onContinue: setSheetPitch,
          onRetry: () => {
            options.reload();
            slots.reload();
            checkout.retry();
          },
          weather: <WeatherStrip weather={weather.weather} loading={weather.loading} />,
          debtMessage: debt.message,
          onPayOwed: openPayOwed,
        }}
      />
      {slot ? (
        <Sheet visible={sheetPitch !== null} onClose={() => setSheetPitch(null)} title={dayTimeLabel(slot.day, slot.start)}>
          <CheckoutView
            variant="sheet"
            pitchKey={sheetPitch}
            venueName={venue?.name ?? ''}
            quote={checkout.quote}
            pitches={checkout.pitches}
            onRetry={checkout.retry}
            onPay={checkout.pay}
            paying={checkout.paying}
            error={checkout.error}
            bookingHeld={checkout.bookingHeld}
            onPayOwed={() => {
              setSheetPitch(null);
              openPayOwed();
            }}
          />
        </Sheet>
      ) : null}
      <Sheet
        visible={choosingMaps}
        onClose={() => setChoosingMaps(false)}
        title="Directions"
        primaryAction={{
          label: 'Open in Apple Maps',
          onPress: () => {
            setChoosingMaps(false);
            if (venue) Linking.openURL(appleMapsUrl(venue));
          },
        }}
        secondaryAction={{ label: 'Open in Google Maps', onPress: () => venue && Linking.openURL(googleMapsUrl(venue)) }}
      />
    </>
  );
}
