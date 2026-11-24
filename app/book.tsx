import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { BookSearchView } from '@/components/booking/book-search-view';
import {
  defaultBookQuery,
  fetchBookSearch,
  fetchSearchOptions,
  loadLastFormat,
  loadRecentPlaces,
  openTimeSlot,
  openVenue,
  playersPerSideFor,
  requestVenue,
  saveLastFormat,
  saveRecentPlace,
  setFavourite,
  useLoad,
  type BookPlace,
  type BookResult,
  type BookSearchQuery,
  type LoadState,
} from '@/lib/booking-search';
import { haptic } from '@/lib/haptics';
import { armStartMatch } from '@/lib/start-match';
import { fetchSearchPlaces } from '@/lib/saved-searches';
import { useDebtBlock } from '@/lib/use-owed';
import { useRules } from '@/lib/use-rules';
import { useVenues } from '@/lib/use-venues';

/** What the search is keyed on: a venue by its id only (its name is just for show). */
function searchKey(q: BookSearchQuery): string {
  const place = q.place.kind === 'venue' ? { kind: 'venue', venueId: q.place.venueId } : q.place;
  return JSON.stringify({ ...q, place });
}

/** Book a pitch (S4; image 02): the server's free venues and times for the
 *  search, with each card's cheapest per-player price. A time opens that
 *  slot (openTimeSlot), a card the venue page. From a venue page (venueId),
 *  the search starts on that venue. */
export default function BookScreen() {
  // Spec 13's rules for the numbers in this screen's text (P10).
  useRules();
  const { venueId, startMatch } = useLocalSearchParams<{ venueId?: string; startMatch?: string }>();
  // S6: opened from Find a match's "Start a match": once paid, Publish starts
  // on. Armed while this screen is open, whichever way the player goes to pay.
  const fromStartMatch = startMatch === '1';
  useEffect(() => {
    if (!fromStartMatch) return;
    armStartMatch(true);
    return () => armStartMatch(false);
  }, [fromStartMatch]);
  const options = useLoad('options', fetchSearchOptions);
  const places = useLoad('places', fetchSearchPlaces);
  const live = useVenues({ liveOnly: true });
  // Only debt blocks booking (spec 13, "Debt"); checked again on return.
  const debt = useDebtBlock();

  const [query, setQuery] = useState<BookSearchQuery | null>(null);
  const [recents, setRecents] = useState<BookPlace[]>([]);
  const [draft, setDraft] = useState<BookSearchQuery | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const optionsData = options.state.status === 'ready' ? options.state.data : null;
  const six = optionsData?.six_on_five_available ?? false;
  const venues = live.status === 'ready' ? live.venues.map((v) => ({ id: v.id, name: v.name, city: v.city })) : [];
  const towns = places.state.status === 'ready' ? places.state.data.map((p) => p.city) : [];

  // The opening search: the last format used (on the phone), today, all day.
  useEffect(() => {
    if (!optionsData || query) return;
    let cancelled = false;
    loadLastFormat().then((last) => {
      if (cancelled) return;
      const q = defaultBookQuery(optionsData, last);
      setQuery(venueId ? { ...q, place: { kind: 'venue', venueId, name: '' } } : q);
    });
    return () => {
      cancelled = true;
    };
  }, [optionsData, query, venueId]);

  useEffect(() => {
    loadRecentPlaces().then(setRecents);
  }, []);

  const results = useLoad(query ? searchKey(query) : null, () => fetchBookSearch(query!, six));
  const count = useLoad(draft ? `count:${searchKey(draft)}` : null, () => fetchBookSearch(draft!, six));

  // While pulling to refresh, keep showing the last results.
  const lastReady = useRef<BookResult[] | null>(null);
  if (results.state.status === 'ready') lastReady.current = results.state.data;
  const shownResults: LoadState<BookResult[]> =
    refreshing && results.state.status === 'loading' && lastReady.current
      ? { status: 'ready', data: lastReady.current }
      : results.state;

  // A venue from a venue page shows its name once the venues are in.
  const shownQuery =
    query && query.place.kind === 'venue' && !query.place.name
      ? { ...query, place: { ...query.place, name: venues.find((v) => v.id === venueId)?.name ?? '' } }
      : query;

  function changeQuery(next: BookSearchQuery) {
    if (query && next.format !== query.format) void saveLastFormat(next.format);
    setQuery(next);
  }

  async function refresh() {
    setRefreshing(true);
    await results.reload();
    setRefreshing(false);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Search' }} />
      <BookSearchView
        options={options.state}
        query={shownQuery}
        onQueryChange={changeQuery}
        results={shownResults}
        refreshing={refreshing}
        onRefresh={refresh}
        onRetryOptions={options.reload}
        onRetryResults={results.reload}
        filterCount={draft && count.state.status === 'ready' ? count.state.data.length : null}
        onFilterDraft={setDraft}
        towns={towns}
        venues={venues}
        recents={recents}
        onPickPlace={(place) => {
          if (query) setQuery({ ...query, place });
          void saveRecentPlace(place).then(setRecents);
        }}
        onOpenVenue={(id) => openVenue(id, router)}
        onTime={(venue, slot) => {
          if (!query) return;
          haptic.tap();
          openTimeSlot(
            {
              venueId: venue.venue_id,
              venueName: venue.name,
              day: slot.day,
              start: slot.start,
              end: slot.end,
              format: query.format,
              playersPerSide: playersPerSideFor(query.format, query.playersPerSide, six),
            },
            router,
          );
        }}
        onFavourite={setFavourite}
        onRequestVenue={requestVenue}
        debtMessage={debt.message}
        onPayOwed={() => router.push('/account/payments/owed')}
      />
    </>
  );
}
