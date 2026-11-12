// The Book flow (spec 15 section 5, "Book"; spec 13 "Booking screens"):
// date strip -> time -> length -> format (and players per side where 6 v 6
// is allowed) -> the venues free at that time, with the server's price per
// player. Picking a venue or one of its times opens checkout.
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  EmptyState,
  SectionHeader,
  SegmentedControl,
  SkeletonBlock,
  SkeletonText,
  Text,
  VenueCard,
} from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import { PITCH_FORMATS } from '@/lib/booking';
import {
  dateStrip,
  dayChipLabel,
  GAME_LENGTHS,
  showPlayersPerSide,
  timeGrid,
  useNow,
  type FreeAtQuery,
  type FreeVenueWithPhoto,
  type GameLength,
  type LoadState,
  type SearchOptions,
} from '@/lib/booking-search';

export type BookSearchViewProps = {
  options: LoadState<SearchOptions>;
  /** From a venue page: only this venue, with its own 6 v 6 setting. */
  venue: { id: string; name: string; allowsSixOnFive: boolean } | null;
  /** The server's free venues for the current query; null until it's complete. */
  results: LoadState<FreeVenueWithPhoto[]> | null;
  onQueryChange: (query: FreeAtQuery | null) => void;
  onChoose: (venue: FreeVenueWithPhoto, start: string) => void;
  onVenueInfo: (venueId: string) => void;
  onRetryOptions: () => void;
  onRetryResults: () => void;
  /** For tests; the screen uses the clock. */
  now?: Date;
};

const PLAYERS_PER_SIDE = [
  { value: '5', label: '5 v 5' },
  { value: '6', label: '6 v 6' },
] as const;

export function BookSearchView(props: BookSearchViewProps) {
  const { options } = props;
  if (options.status === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <SkeletonText lines={1} variant="headline" />
          <SkeletonBlock width="100%" height={48} rounded="control" />
          <SkeletonBlock width="100%" height={96} />
        </View>
      </View>
    );
  }
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
  return <BookSearchReady {...props} options={options.data} />;
}

function BookSearchReady({
  options,
  venue,
  results,
  onQueryChange,
  onChoose,
  onVenueInfo,
  onRetryResults,
  now: nowOverride,
}: Omit<BookSearchViewProps, 'options'> & { options: SearchOptions }) {
  const clock = useNow();
  const now = nowOverride ?? clock;
  const days = useMemo(() => dateStrip(options.today, options.window_days), [options.today, options.window_days]);

  const [day, setDay] = useState(days[0]);
  const [start, setStart] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<GameLength>(60);
  const [format, setFormat] = useState<string | null>(null);
  const [playersPerSide, setPlayersPerSide] = useState<5 | 6>(5);

  const times = timeGrid(day, now, minutes);
  const sixAllowed = venue ? venue.allowsSixOnFive : options.six_on_five_available;
  const showSides = showPlayersPerSide(format, sixAllowed);
  const sides: 5 | 6 = showSides ? playersPerSide : 5;
  // A start time that has passed (or belongs to another day) is no choice.
  const startTime = start && times.includes(start) ? start : null;

  useEffect(() => {
    onQueryChange(startTime && format ? { day, start: startTime, minutes, format, playersPerSide: sides } : null);
    // onQueryChange is the screen's setter; the query is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, startTime, minutes, format, sides]);

  const shown = results?.status === 'ready' ? results.data.filter((v) => !venue || v.venue_id === venue.id) : [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {venue ? (
        <Text variant="title" accessibilityRole="header">
          {venue.name}
        </Text>
      ) : null}

      <View style={styles.section}>
        <SectionHeader title="Day" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {days.map((d) => (
            <Chip key={d} label={dayChipLabel(d, options.today)} selected={d === day} onPress={() => setDay(d)} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Time" />
        {times.length === 0 ? (
          <Text variant="body" tone="inkMuted">
            No more start times today. Pick another day.
          </Text>
        ) : (
          <View style={styles.wrap}>
            {times.map((t) => (
              <Chip key={t} label={t} tabular selected={t === startTime} onPress={() => setStart(t)} />
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Length" />
        <View style={styles.wrap}>
          {GAME_LENGTHS.map((m) => (
            <Chip key={m} label={`${m} min`} tabular selected={m === minutes} onPress={() => setMinutes(m)} />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Format" />
        <View style={styles.wrap}>
          {PITCH_FORMATS.map((f) => (
            <Chip key={f} label={f} selected={f === format} onPress={() => setFormat(f)} />
          ))}
        </View>
        {showSides ? (
          <SegmentedControl
            accessibilityLabel="Players per side"
            options={[...PLAYERS_PER_SIDE]}
            value={String(playersPerSide) as '5' | '6'}
            onChange={(v) => setPlayersPerSide(v === '6' ? 6 : 5)}
          />
        ) : null}
      </View>

      {results ? (
        <View style={styles.section}>
          <SectionHeader title={venue ? 'Available' : 'Free at this time'} />
          {results.status === 'loading' ? <SkeletonBlock width="100%" height={220} /> : null}
          {results.status === 'error' ? (
            <EmptyState
              icon="exclamationmark.circle.fill"
              message={results.message}
              action={{ label: 'Try again', onPress: onRetryResults }}
            />
          ) : null}
          {results.status === 'ready' && shown.length === 0 ? (
            <EmptyState
              icon="calendar"
              message={venue ? `${venue.name} isn't free at this time. Try another time.` : 'No venue is free at this time. Try another time.'}
            />
          ) : null}
          {shown.map((v) => (
            <View key={v.venue_id} style={styles.card}>
              <VenueCard
                testID={`free-venue-${v.venue_id}`}
                name={v.name}
                area={v.city ?? v.address ?? ''}
                pricePerPlayerCents={v.player_cents}
                photoUrl={v.photoUrl}
                nextTimes={v.next_starts.map((t) => t.slice(0, 5))}
                onPress={() => startTime && onChoose(v, startTime)}
                onTimePress={(t) => onChoose(v, t)}
              />
              <Button label="Venue info" variant="plain" onPress={() => onVenueInfo(v.venue_id)} />
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
  row: { gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { gap: space.xs },
});
