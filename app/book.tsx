import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { BookSearchView } from '@/components/booking/book-search-view';
import { AskAiButton } from '@/components/futty-ai/ask-ai-button';
import { Text } from '@/components/ui';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { space } from '@/constants/futty-theme';
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
import { armBookingPreselect } from '@/lib/booking-preselect';
import { haptic } from '@/lib/haptics';
import { armStartMatch } from '@/lib/start-match';
import { fetchSearchPlaces } from '@/lib/saved-searches';
import { useDebtBlock } from '@/lib/use-owed';
import { useRules } from '@/lib/use-rules';
import { useVenues } from '@/lib/use-venues';
import {
  distanceKm,
  distanceLabel,
  fetchVenueCoordinates,
  locateMe,
  sortByDistance,
  type Coordinates,
} from '@/lib/venue-location';

/** S17: why Around me couldn't start, and the one thing to do about it. */
const LOCATION_OFF = 'Location is off. Turn it on in Settings.';
const NOT_FOUND = 'Couldn’t find you. Try again.';

/** What the search is keyed on: a venue by its id only (its name is just for show). */
function searchKey(q: BookSearchQuery): string {
  const place = q.place.kind === 'venue' ? { kind: 'venue', venueId: q.place.venueId } : q.place;
  return JSON.stringify({ ...q, place });
}

/** Book a pitch (S4; image 02): the server's free venues and times for the
 *  search, with each card's cheapest per-player price. A time opens that
 *  slot (openTimeSlot), a card the venue page. From a venue page (venueId),
 *  the search starts on that venue.
 *
 *  S17: "Around me" asks for the location only when tapped (locateMe rounds
 *  it to about 1 km) and sorts the results by distance here on the phone:
 *  the location is never sent to the server. "View map" in the header shows
 *  the same results as pins. */
export default function BookScreen() {
  // Spec 13's rules for the numbers in this screen's text (P10).
  useRules();
  const { venueId, startMatch, inviteProfileId, oppositionTeamId } = useLocalSearchParams<{
    venueId?: string;
    startMatch?: string;
    inviteProfileId?: string;
    oppositionTeamId?: string;
  }>();
  // S6: opened from Find a match's "Start a match": once paid, Publish starts
  // on. Armed while this screen is open, whichever way the player goes to pay.
  const fromStartMatch = startMatch === '1';
  useEffect(() => {
    if (!fromStartMatch) return;
    armStartMatch(true);
    return () => armStartMatch(false);
  }, [fromStartMatch]);
  // S20: opened from a friend chat ("Book together", "Team vs team"): the
  // friend or the friend's team is preselected after paying. Armed while
  // this screen is open, like Start a match.
  useEffect(() => {
    if (!inviteProfileId && !oppositionTeamId) return;
    armBookingPreselect({ inviteProfileId, oppositionTeamId });
    return () => armBookingPreselect(null);
  }, [inviteProfileId, oppositionTeamId]);
  const options = useLoad('options', fetchSearchOptions);
  const places = useLoad('places', fetchSearchPlaces);
  const live = useVenues({ liveOnly: true });
  // Only debt blocks booking (spec 13, "Debt"); checked again on return.
  const debt = useDebtBlock();

  const [query, setQuery] = useState<BookSearchQuery | null>(null);
  const [recents, setRecents] = useState<BookPlace[]>([]);
  const [draft, setDraft] = useState<BookSearchQuery | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [here, setHere] = useState<Coordinates | null>(null);
  const [locationProblem, setLocationProblem] = useState<'denied' | 'failed' | null>(null);

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

  // S17: the results' coordinates, for Around me and the map.
  const resultIds = shownResults.status === 'ready' ? shownResults.data.map((r) => r.venue_id) : null;
  const coordsKey = resultIds ? `coords:${resultIds.join(',')}` : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids are the key
  const loadCoords = useCallback(() => fetchVenueCoordinates(resultIds ?? []), [coordsKey]);
  const coords = useLoad(coordsKey, loadCoords);
  const coordinates = coords.state.status === 'ready' ? coords.state.data : {};
  const sortedResults: LoadState<BookResult[]> =
    here && shownResults.status === 'ready'
      ? { status: 'ready', data: sortByDistance(shownResults.data, coordinates, here) }
      : shownResults;
  const distances: Record<string, string> = {};
  if (here) {
    for (const [id, at] of Object.entries(coordinates)) distances[id] = distanceLabel(distanceKm(here, at));
  }

  async function aroundMe() {
    setLocationProblem(null);
    const found = await locateMe();
    if (found.status === 'ready') setHere(found.here);
    else setLocationProblem(found.status);
  }

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
      <Stack.Screen
        options={{
          title: 'Search',
          headerRight: () => (
            <View style={styles.header}>
              <Pressable
                testID="book-view-map"
                accessibilityRole="button"
                accessibilityLabel={view === 'map' ? 'View list' : 'View map'}
                onPress={() => setView(view === 'map' ? 'list' : 'map')}
                style={styles.headerButton}>
                <Text variant="body">{view === 'map' ? 'View list' : 'View map'}</Text>
              </Pressable>
              <AskAiButton testID="book-ask-ai" />
            </View>
          ),
        }}
      />
      <BookSearchView
        options={options.state}
        query={shownQuery}
        onQueryChange={changeQuery}
        results={sortedResults}
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
          setHere(null);
          setLocationProblem(null);
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
        view={view}
        onViewChange={setView}
        onAroundMe={() => void aroundMe()}
        nearMe={here !== null}
        distances={distances}
        coordinates={coordinates}
        locationProblem={
          locationProblem === 'denied'
            ? { message: LOCATION_OFF, action: { label: 'Open Settings', onPress: () => void Linking.openSettings() } }
            : locationProblem === 'failed'
            ? { message: NOT_FOUND, action: { label: 'Try again', onPress: () => void aroundMe() } }
            : null
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headerButton: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: space.xs },
});
