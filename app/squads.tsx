// Find a match (S6; image 05): Home → "Find a match" (and Home's "Find a
// game" links, which still open /squads). The public open games from the
// server (find_matches), priced as B4 prices them, grouped by Cyprus day.
// A card opens the existing B4 join or "Accept as opponent" screen; "Start a
// match" opens Book a pitch with Publish preselected after paying. The old
// posts list (Your games, older opposition offers) is app/squad-posts.tsx.
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FindMatchView } from '@/components/booking/find-match/find-match-view';
import {
  fetchSearchOptions,
  loadRecentPlaces,
  requestVenue,
  saveRecentPlace,
  useLoad,
  type BookPlace,
  type LoadState,
} from '@/lib/booking-search';
import {
  cardHref,
  emptyFilters,
  fetchMatches,
  groupByDay,
  loadMatchFilters,
  saveMatchFilters,
  withoutPastDays,
  type MatchFilters,
  type MatchSection,
} from '@/lib/find-match';
import { haptic } from '@/lib/haptics';
import { fetchSearchPlaces } from '@/lib/saved-searches';
import { useRules } from '@/lib/use-rules';
import { useVenues } from '@/lib/use-venues';

export default function FindMatchScreen() {
  // Spec 13's rules for any numbers in the text (P10).
  useRules();
  const options = useLoad('options', fetchSearchOptions);
  const places = useLoad('places', fetchSearchPlaces);
  const live = useVenues({ liveOnly: true });
  const today = options.state.status === 'ready' ? options.state.data.today : null;
  const windowDays = options.state.status === 'ready' ? options.state.data.window_days : 0;
  const towns = places.state.status === 'ready' ? places.state.data.map((p) => p.city) : [];
  const venues = live.status === 'ready' ? live.venues.map((v) => ({ id: v.id, name: v.name, city: v.city })) : [];

  // undefined: still reading the phone; null: no filters yet.
  const [filters, setFilters] = useState<MatchFilters | null | undefined>(undefined);
  const [recents, setRecents] = useState<BookPlace[]>([]);
  useEffect(() => {
    let current = true;
    void loadMatchFilters().then((saved) => {
      if (current) setFilters(saved);
    });
    void loadRecentPlaces().then((saved) => {
      if (current) setRecents(saved);
    });
    return () => {
      current = false;
    };
  }, []);

  // Days already gone drop off once the server's today is known.
  const shown = filters && today ? withoutPastDays(filters, today) : filters;
  const key = shown && today ? JSON.stringify(shown) : null;
  const load = useCallback(async () => (shown ? fetchMatches(shown) : []), [shown]);
  const results = useLoad(key, load);

  const [refreshing, setRefreshing] = useState(false);
  const lastReady = useRef<LoadState<MatchSection[]> | null>(null);
  const sectionsState: LoadState<MatchSection[]> =
    options.state.status === 'error'
      ? options.state
      : results.state.status === 'ready' && today
      ? { status: 'ready', data: groupByDay(results.state.data, today) }
      : results.state.status === 'error'
        ? results.state
        : { status: 'loading' };
  if (sectionsState.status === 'ready') lastReady.current = sectionsState;
  // While refreshing, the list stays as it was.
  const resultsShown = refreshing && sectionsState.status === 'loading' ? lastReady.current ?? sectionsState : sectionsState;

  function apply(next: MatchFilters) {
    setFilters(next);
    void saveMatchFilters(next);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Matches' }} />
      <FindMatchView
        today={today}
        windowDays={windowDays}
        towns={towns}
        venues={venues}
        recents={recents}
        // Until the phone has answered, the screen shows skeletons, not "No filters yet".
        filters={filters === undefined ? emptyFilters() : shown ?? null}
        results={filters === null ? null : resultsShown}
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await results.reload();
          setRefreshing(false);
        }}
        onRetry={() => {
          options.reload();
          void results.reload();
        }}
        onApplyFilters={apply}
        onPickPlace={(place) => {
          apply({ ...(shown ?? emptyFilters()), place });
          void saveRecentPlace(place).then(setRecents);
        }}
        onRequestVenue={requestVenue}
        onOpenCard={(card) => router.push(cardHref(card))}
        onOpenPlayer={(profileId) => router.push({ pathname: '/player-profile', params: { profileId } })}
        onOpenTeam={(teamId) => router.push({ pathname: '/team-profile', params: { teamId } })}
        onStartMatch={() => {
          haptic.tap();
          router.push({ pathname: '/book', params: { startMatch: '1' } });
        }}
      />
    </>
  );
}
