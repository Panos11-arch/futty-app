// Book a pitch (S4; image 02; Playtomic 01, 02, 05, 12, 13, 14): the
// search field (a place, and a heart for favourites only), the chips
// Filters · format · day · time, and the venues with their free times and
// "from €X.XX per player" (the server's cheapest price among the times the
// card shows). A time opens that slot; a card opens the venue page.
//
// S17: "Around me" in the picker sorts by distance (on the phone; the
// screen passes the sorted list and each card's distance), and "View map"
// (the screen's header) shows the same venues as pins (VenuesMap).
//
// A player in debt (my_owed says blocked) sees a banner linking to "Pay
// what I owe" and can't pick a time (spec 13, "Debt"); book_slot refuses
// anyway.
import { useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, View } from 'react-native';

import { AmenitiesSheet } from '@/components/booking/book-search/amenities-sheet';
import { ChooseDaysSheet } from '@/components/booking/book-search/choose-days-sheet';
import { FilterSheet } from '@/components/booking/book-search/filter-sheet';
import { FormatSheet } from '@/components/booking/book-search/format-sheet';
import { MissingVenueSheet } from '@/components/booking/book-search/missing-venue-sheet';
import { TimeSheet } from '@/components/booking/book-search/time-sheet';
import { VenueResultCard } from '@/components/booking/book-search/venue-result-card';
import { VenuesMap } from '@/components/booking/book-search/venues-map';
import { WherePicker } from '@/components/booking/book-search/where-picker';
import { Banner, Button, Chip, EmptyState, SkeletonBlock, Text } from '@/components/ui';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { radius, space } from '@/constants/futty-theme';
import {
  daysChipLabel,
  defaultBookQuery,
  offeredLengths,
  placeLabel,
  timeChipLabel,
  type BookPlace,
  type BookResult,
  type BookSearchQuery,
  type BookSlot,
  type LoadState,
  type PlaceVenue,
  type SearchOptions,
} from '@/lib/booking-search';
import { makeStyles, useTheme } from '@/lib/theme';
import type { Coordinates } from '@/lib/venue-location';

export type BookSearchViewProps = {
  options: LoadState<SearchOptions>;
  /** The search; null until the screen has read the last format used. */
  query: BookSearchQuery | null;
  onQueryChange: (query: BookSearchQuery) => void;
  results: LoadState<BookResult[]>;
  refreshing: boolean;
  onRefresh: () => void;
  onRetryOptions: () => void;
  onRetryResults: () => void;
  /** The Filter sheet's live count for its draft; null while counting. */
  filterCount: number | null;
  /** The Filter sheet's draft to count, or null when the sheet closes. */
  onFilterDraft: (draft: BookSearchQuery | null) => void;
  towns: string[];
  venues: PlaceVenue[];
  recents: BookPlace[];
  onPickPlace: (place: BookPlace) => void;
  onOpenVenue: (venueId: string) => void;
  onTime: (venue: BookResult, slot: BookSlot) => void;
  /** Saves or removes a favourite; rejects with the words to show. */
  onFavourite: (venueId: string, on: boolean) => Promise<void>;
  /** "Missing a venue?"; rejects with the words to show. */
  onRequestVenue: (venueName: string, town: string) => Promise<void>;
  /** The debt banner's words when my_owed says the player is blocked. */
  debtMessage?: string | null;
  onPayOwed?: () => void;
  /** S17: the list, or the venues as pins (the header's View map). */
  view?: 'list' | 'map';
  onViewChange?: (view: 'list' | 'map') => void;
  /** S17: the picker's Around me; the screen asks for the location. */
  onAroundMe?: () => void;
  /** S17: Around me is on: the results come nearest first. */
  nearMe?: boolean;
  /** S17: each venue's distance ("3 km") while Around me is on. */
  distances?: Record<string, string>;
  /** S17: the results' coordinates, for the map. */
  coordinates?: Record<string, Coordinates>;
  /** S17: why Around me couldn't start, and what to do (one line). */
  locationProblem?: { message: string; action: { label: string; onPress: () => void } } | null;
};

type Open = 'where' | 'format' | 'days' | 'time' | 'amenities' | 'filter' | 'missing' | null;

export function BookSearchView(props: BookSearchViewProps) {
  const styles = useStyles();
  const { options, query } = props;
  if (options.status === 'error') {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="exclamationmark.circle.fill"
          message={options.message}
          action={{ label: 'Try again', onPress: props.onRetryOptions }}
        />
      </View>
    );
  }
  if (options.status === 'loading' || !query) {
    return (
      <View testID="book-loading" style={[styles.screen, styles.pad]}>
        <SkeletonBlock width="100%" height={MIN_TOUCH} rounded="control" />
        <ResultSkeletons />
      </View>
    );
  }
  return <BookSearchReady {...props} options={options.data} query={query} />;
}

function ResultSkeletons() {
  const styles = useStyles();
  return (
    <View testID="book-results-loading" style={styles.list}>
      <SkeletonBlock width="100%" height={300} />
      <SkeletonBlock width="100%" height={300} />
    </View>
  );
}

function BookSearchReady({
  options,
  query,
  onQueryChange,
  results,
  refreshing,
  onRefresh,
  onRetryResults,
  filterCount,
  onFilterDraft,
  towns,
  venues,
  recents,
  onPickPlace,
  onOpenVenue,
  onTime,
  onFavourite,
  onRequestVenue,
  debtMessage,
  onPayOwed,
  view = 'list',
  onViewChange,
  onAroundMe,
  nearMe = false,
  distances = {},
  coordinates = {},
  locationProblem = null,
}: Omit<BookSearchViewProps, 'options' | 'query'> & { options: SearchOptions; query: BookSearchQuery }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState<Open>(null);
  const missingAfterPicker = useRef(false);
  // Favourites change at once on screen; the server catches up.
  const [favourites, setFavourites] = useState<Record<string, boolean>>({});
  const [favouriteError, setFavouriteError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const blocked = Boolean(debtMessage);
  const defaults = useMemo(() => defaultBookQuery(options, query.format), [options, query.format]);
  const filtersOn =
    query.includeUnavailable ||
    query.types.length > 0 ||
    query.playersPerSide !== defaults.playersPerSide ||
    query.minutes !== defaults.minutes;
  const severalDays = query.days.length > 1;

  const close = () => setOpen(null);
  const where = nearMe ? 'Around me' : placeLabel(query.place);
  const placeLine = (r: BookResult) => [distances[r.venue_id], r.area, r.town].filter(Boolean).join(' · ');

  async function toggleFavourite(venueId: string, on: boolean) {
    setFavouriteError(null);
    setFavourites((f) => ({ ...f, [venueId]: on }));
    try {
      await onFavourite(venueId, on);
    } catch (e) {
      setFavourites((f) => ({ ...f, [venueId]: !on }));
      setFavouriteError(e instanceof Error ? e.message : 'Couldn’t save this venue. Try again.');
    }
  }

  const data = results.status === 'ready' ? results.data.map((r) => ({ ...r, is_favourite: favourites[r.venue_id] ?? r.is_favourite })) : [];

  const header = (
    <View style={styles.banners}>
      {debtMessage ? (
        <View testID="debt-banner">
          <Banner
            tone="danger"
            message={debtMessage}
            action={onPayOwed ? { label: 'Pay what I owe', onPress: onPayOwed } : undefined}
          />
        </View>
      ) : null}
      {favouriteError ? <Banner tone="danger" message={favouriteError} /> : null}
      {sent ? <Banner tone="info" message="Venue sent" /> : null}
      {locationProblem ? (
        <View testID="book-location-banner">
          <Banner tone="warning" message={locationProblem.message} action={locationProblem.action} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <View style={styles.field}>
          <Pressable
            testID="book-search-field"
            accessibilityRole="search"
            accessibilityLabel={`Where: ${where}`}
            onPress={() => setOpen('where')}
            style={styles.fieldPress}>
            <IconSymbol name="magnifyingglass" size={ICON.small} color={colors.inkMuted} />
            <Text variant="body" tone="inkMuted" numberOfLines={1} style={styles.fieldText}>
              {where}
            </Text>
          </Pressable>
          <Pressable
            testID="book-favourites"
            accessibilityRole="button"
            accessibilityLabel="Favourites only"
            accessibilityState={{ selected: query.favouritesOnly }}
            onPress={() => onQueryChange({ ...query, favouritesOnly: !query.favouritesOnly })}
            style={styles.heart}>
            <IconSymbol name={query.favouritesOnly ? 'heart.fill' : 'heart'} size={ICON.regular} color={colors.ink} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip
            testID="book-chip-filters"
            label="Filters"
            selected={filtersOn}
            onPress={() => {
              setOpen('filter');
              onFilterDraft(query);
            }}
          />
          <Chip testID="book-chip-format" label={query.format} selected onPress={() => setOpen('format')} />
          <Chip
            testID="book-chip-date"
            label={daysChipLabel(query.days, options.today)}
            selected={query.days.length !== 1 || query.days[0] !== options.today}
            onPress={() => setOpen('days')}
          />
          <Chip
            testID="book-chip-time"
            label={timeChipLabel(query.window)}
            selected={query.window.preset !== 'all_day'}
            onPress={() => setOpen('time')}
          />
          <Chip
            testID="book-chip-amenities"
            label="Amenities"
            selected={query.amenities.length > 0}
            onPress={() => setOpen('amenities')}
          />
        </ScrollView>
      </View>

      {results.status === 'error' ? (
        <View>
          {header}
          <EmptyState
            icon="exclamationmark.circle.fill"
            message={results.message}
            action={{ label: 'Try again', onPress: onRetryResults }}
          />
        </View>
      ) : results.status === 'loading' && !refreshing ? (
        <View style={styles.pad}>
          {header}
          <ResultSkeletons />
        </View>
      ) : view === 'map' ? (
        <View style={styles.map}>
          {header}
          <VenuesMap
            results={data}
            coordinates={coordinates}
            placeLine={placeLine}
            onOpenVenue={onOpenVenue}
            onList={() => onViewChange?.('list')}
          />
        </View>
      ) : (
        <FlatList
          testID="book-results"
          data={data}
          keyExtractor={(r) => r.venue_id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          onRefresh={onRefresh}
          refreshing={refreshing}
          ListEmptyComponent={
            <View style={styles.empty}>
              <IconSymbol name="sportscourt.fill" size={ICON.regular * 2} color={colors.inkMuted} />
              <Text variant="headline">No venues found</Text>
              <Text variant="callout" tone="inkMuted">
                Try other days, times or filters.
              </Text>
              <Button
                testID="book-missing-venue"
                label="Missing a venue?"
                variant="secondary"
                onPress={() => setOpen('missing')}
              />
            </View>
          }
          renderItem={({ item }) => (
            <VenueResultCard
              result={item}
              severalDays={severalDays}
              timesDisabled={blocked}
              onOpen={() => onOpenVenue(item.venue_id)}
              onTime={(slot) => {
                if (!blocked) onTime(item, slot);
              }}
              onFavourite={(on) => toggleFavourite(item.venue_id, on)}
              distance={distances[item.venue_id]}
            />
          )}
        />
      )}

      <WherePicker
        visible={open === 'where'}
        onClose={close}
        towns={towns}
        venues={venues}
        recents={recents}
        onPick={(place) => {
          close();
          onPickPlace(place);
        }}
        onAroundMe={
          onAroundMe
            ? () => {
                close();
                onAroundMe();
              }
            : undefined
        }
        onMissingVenue={() => {
          // iOS can't show the sheet while the full-screen picker is still
          // closing: it opens once the picker has gone (onDismissed).
          if (Platform.OS === 'ios') {
            missingAfterPicker.current = true;
            setOpen(null);
          } else {
            setOpen('missing');
          }
        }}
        onDismissed={() => {
          if (missingAfterPicker.current) {
            missingAfterPicker.current = false;
            setOpen('missing');
          }
        }}
      />
      <FormatSheet
        visible={open === 'format'}
        onClose={close}
        value={query.format}
        onPick={(format) => {
          close();
          if (format !== query.format) onQueryChange({ ...query, format, playersPerSide: 5 });
        }}
      />
      <ChooseDaysSheet
        visible={open === 'days'}
        onClose={close}
        today={options.today}
        windowDays={options.window_days}
        selected={query.days}
        onApply={(days) => {
          close();
          onQueryChange({ ...query, days });
        }}
      />
      <AmenitiesSheet
        visible={open === 'amenities'}
        onClose={close}
        value={query.amenities}
        onApply={(amenities) => {
          close();
          onQueryChange({ ...query, amenities });
        }}
      />
      <TimeSheet
        visible={open === 'time'}
        onClose={close}
        value={query.window}
        onApply={(window) => {
          close();
          onQueryChange({ ...query, window });
        }}
      />
      <FilterSheet
        visible={open === 'filter'}
        onClose={() => {
          close();
          onFilterDraft(null);
        }}
        value={query}
        defaults={defaults}
        lengths={offeredLengths(options)}
        sixOnFiveAllowed={options.six_on_five_available}
        count={filterCount}
        onDraftChange={onFilterDraft}
        onApply={(draft) => {
          close();
          onFilterDraft(null);
          onQueryChange(draft);
        }}
      />
      <MissingVenueSheet
        visible={open === 'missing'}
        onClose={close}
        onSend={async (name, town) => {
          await onRequestVenue(name, town);
          setSent(true);
        }}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors, hairline }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  pad: { padding: space.lg, gap: space.md },
  top: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    gap: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.fill,
    borderRadius: radius.control,
    minHeight: MIN_TOUCH + space.sm,
    paddingLeft: space.lg,
  },
  fieldPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH },
  fieldText: { flex: 1 },
  heart: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: space.sm },
  banners: { gap: space.md },
  list: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  map: { flex: 1 },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxl },
}));
