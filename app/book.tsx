import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { BookSearchView } from '@/components/booking/book-search-view';
import {
  endTime,
  fetchSearchOptions,
  fetchVenuesFreeAt,
  useLoad,
  type FreeAtQuery,
  type FreeVenueWithPhoto,
} from '@/lib/booking-search';
import { useDebtBlock } from '@/lib/use-owed';
import { useVenuePage } from '@/lib/use-venue-page';

/** Book a pitch (P5): the server's window, free venues and prices; checkout
 *  happens on booking-payment. From a venue page (venueId), only that venue. */
export default function BookScreen() {
  const { venueId } = useLocalSearchParams<{ venueId?: string }>();
  const options = useLoad('options', fetchSearchOptions);
  const venuePage = useVenuePage(venueId);
  // Only debt blocks booking (spec 13, "Debt"); checked again on return.
  const debt = useDebtBlock();

  const [query, setQuery] = useState<FreeAtQuery | null>(null);
  const loadFree = useCallback(() => fetchVenuesFreeAt(query!), [query]);
  const results = useLoad(query ? JSON.stringify(query) : null, loadFree);

  // From a venue page the screen waits for that venue's own 6 v 6 setting.
  const venue =
    venueId && venuePage.state.status === 'ready'
      ? {
          id: venueId,
          name: venuePage.state.data.venue.name,
          allowsSixOnFive: venuePage.state.data.venue.allows_6v6_on_5s === true,
        }
      : null;
  const optionsState =
    venueId && venuePage.state.status === 'loading'
      ? ({ status: 'loading' } as const)
      : venueId && (venuePage.state.status === 'error' || venuePage.state.status === 'not_found')
        ? ({ status: 'error', message: "Couldn't load this venue." } as const)
        : options.state;

  function choose(v: FreeVenueWithPhoto, start: string) {
    if (!query) return;
    const end = endTime(start, query.minutes);
    if (!end) return;
    router.push({
      pathname: '/booking-payment',
      params: {
        venueId: v.venue_id,
        venueName: v.name,
        day: query.day,
        start,
        end,
        format: query.format,
        playersPerSide: String(query.playersPerSide),
      },
    });
  }

  return (
    <BookSearchView
      options={optionsState}
      venue={venue}
      results={query ? results.state : null}
      onQueryChange={setQuery}
      onChoose={choose}
      onVenueInfo={(id) => router.push({ pathname: '/venue/[id]', params: { id } })}
      onRetryOptions={() => {
        options.reload();
        venuePage.reload();
      }}
      onRetryResults={results.reload}
      debtMessage={debt.message}
      onPayOwed={() => router.push('/account/payments/owed')}
    />
  );
}
