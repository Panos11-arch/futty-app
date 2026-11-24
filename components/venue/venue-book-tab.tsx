// The venue page's Book tab (S5; 03-venue-book-tab): format, players per
// side where 6 v 6 is allowed, the day strip (the account's window, from the
// server), the game length, the day's times (taken ones struck through), then
// Booking v2's pitch list for the chosen time with the server's prices. The
// page's sticky bar opens the payment sheet. Every free time, pitch and price
// comes from the server; this view only shows them.
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { PitchRow } from '@/components/booking/checkout-choice';
import { Banner, Chip, SectionHeader, SegmentedControl, SkeletonBlock, Text } from '@/components/ui';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { dateStrip, GAME_LENGTHS, showPlayersPerSide, type LoadState, type SearchOptions } from '@/lib/booking-search';
import { pitchDetails, type FreePitch } from '@/lib/booking-v2';
import { formatEuros } from '@/lib/money/format';
import type { VenueFormatsState, VenueSlotsState } from '@/lib/use-venue-slots';
import { bookTimes, dayCell, type BookSelection } from '@/lib/venue-book';

export type VenueBookProps = {
  options: LoadState<SearchOptions>;
  formats: VenueFormatsState;
  slots: VenueSlotsState;
  /** venue_free_pitches for the chosen time; null until a time is chosen. */
  pitches: LoadState<FreePitch[]> | null;
  selection: BookSelection;
  onSelect: (selection: BookSelection) => void;
  /** The pitch tapped, by its ids joined with commas; null = the first free one. */
  pitchKey: string | null;
  onPitch: (key: string) => void;
  /** Continue, with the chosen pitch's key. */
  onContinue: (pitchKey: string) => void;
  onRetry: () => void;
  /** The weather strip for the chosen time (P11). */
  weather?: ReactNode;
  /** The debt banner's words when the player can't book (spec 13, "Debt"). */
  debtMessage?: string | null;
  onPayOwed?: () => void;
  /** For tests; the screen uses the clock. */
  now?: Date;
};

const PLAYERS_PER_SIDE = [
  { value: '5', label: '5 v 5', testID: 'venue-sides-5' },
  { value: '6', label: '6 v 6', testID: 'venue-sides-6' },
] as const;

/** The pitch the bar and Continue use: the one tapped, or the first free one. */
export function chosenPitch(book: Pick<VenueBookProps, 'pitches' | 'pitchKey'>): FreePitch | null {
  if (!book.pitches || book.pitches.status !== 'ready') return null;
  const free = book.pitches.data;
  return free.find((p) => p.pitch_ids.join(',') === book.pitchKey) ?? free[0] ?? null;
}

export function VenueBookTab({ book, allowsSixOnFive }: { book: VenueBookProps; allowsSixOnFive: boolean }) {
  const styles = useStyles();
  const { options, formats, selection, onSelect } = book;
  const set = (patch: Partial<BookSelection>) => onSelect({ ...selection, ...patch });
  const chosen = chosenPitch(book);
  const retry = <Banner tone="danger" message="Could not load the times. Try again." action={{ label: 'Try again', onPress: book.onRetry }} />;

  if (options.status === 'loading' || formats.status === 'loading' || formats.status === 'idle') {
    return (
      <View style={styles.tab} testID="venue-book-loading">
        <SkeletonBlock width="100%" height={MIN_TOUCH} rounded="control" />
        <SkeletonBlock width="100%" height={MIN_TOUCH * 2} />
      </View>
    );
  }
  if (options.status === 'error' || formats.status === 'error') return retry;

  const days = dateStrip(options.data.today, options.data.window_days);
  const sides = showPlayersPerSide(selection.format, allowsSixOnFive);
  const now = book.now ?? new Date();

  return (
    <View style={styles.tab}>
      {book.debtMessage ? (
        <Banner
          tone="danger"
          message={book.debtMessage}
          action={book.onPayOwed ? { label: 'Pay what I owe', onPress: book.onPayOwed } : undefined}
        />
      ) : null}

      <View style={styles.section}>
        <SectionHeader title="Format" />
        <View style={styles.wrap}>
          {formats.formats.map((f) => (
            <Chip
              key={f}
              testID={`venue-format-${f}`}
              label={f}
              selected={selection.format === f}
              onPress={() => set({ format: f, start: null, playersPerSide: 5 })}
            />
          ))}
        </View>
        {sides ? (
          <SegmentedControl
            accessibilityLabel="Players per side"
            options={[...PLAYERS_PER_SIDE]}
            value={String(selection.playersPerSide) as '5' | '6'}
            onChange={(v) => set({ playersPerSide: v === '6' ? 6 : 5, start: null })}
          />
        ) : null}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Day" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
          {days.map((day) => {
            const cell = dayCell(day);
            const selected = day === selection.day;
            return (
              <Pressable
                key={day}
                testID={`venue-day-${day}`}
                accessibilityRole="button"
                accessibilityLabel={cell.label}
                accessibilityState={{ selected }}
                onPress={() => set({ day, start: null })}
                style={[styles.day, selected && styles.daySelected]}>
                <Text variant="caption" tone={selected ? 'onNightMuted' : 'inkMuted'}>
                  {cell.weekday}
                </Text>
                <Text variant="number" tone={selected ? 'onNight' : 'ink'} tabular>
                  {cell.date}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <SectionHeader title={`Time · ${selection.minutes} min`} />
        {GAME_LENGTHS.length > 1 ? (
          <View style={styles.wrap}>
            {GAME_LENGTHS.map((m) => (
              <Chip
                key={m}
                testID={`venue-length-${m}`}
                label={`${m} min`}
                selected={selection.minutes === m}
                onPress={() => set({ minutes: m, start: null })}
              />
            ))}
          </View>
        ) : null}
        <Times book={book} now={now} retry={retry} />
      </View>

      {selection.start ? (
        <View style={styles.section}>
          <SectionHeader title="Pitch" />
          {!book.pitches || book.pitches.status === 'loading' ? (
            <SkeletonBlock width="100%" height={MIN_TOUCH + space.lg} rounded="control" />
          ) : book.pitches.status === 'error' ? (
            retry
          ) : book.pitches.data.length === 0 ? (
            <Text variant="body" tone="inkMuted">
              No pitch is free at this time. Pick another time.
            </Text>
          ) : (
            book.pitches.data.map((p, i) => (
              <PitchRow
                key={p.pitch_ids.join(',')}
                testID={`venue-book-pitch-${i + 1}`}
                label={p.label}
                details={pitchDetails(p)}
                price={formatEuros(p.price_cents)}
                selected={p === chosen}
                onPress={() => book.onPitch(p.pitch_ids.join(','))}
              />
            ))
          )}
        </View>
      ) : null}

      {/* The forecast for the chosen time (P11; restyled in S17). */}
      <View testID="weather-strip-slot">{selection.start ? book.weather : null}</View>
    </View>
  );
}

function Times({ book, now, retry }: { book: VenueBookProps; now: Date; retry: ReactNode }) {
  const styles = useStyles();
  const { slots, selection } = book;
  if (slots.status === 'loading' || slots.status === 'idle') {
    return <SkeletonBlock width="100%" height={MIN_TOUCH * 2} />;
  }
  if (slots.status === 'error') return <>{retry}</>;
  if (slots.status === 'closed') {
    return (
      <Text variant="body" tone="inkMuted">
        Closed this day. Pick another day.
      </Text>
    );
  }
  const times = bookTimes(slots.slots, selection.day, now);
  if (times.length === 0) {
    return (
      <Text variant="body" tone="inkMuted">
        No times left this day. Pick another day.
      </Text>
    );
  }
  return (
    <View style={styles.times}>
      {times.map((t) => {
        const selected = t.start === selection.start;
        return (
          <Pressable
            key={t.start}
            testID={`venue-time-${t.start.replace(':', '')}`}
            accessibilityRole="button"
            accessibilityLabel={t.taken ? `${t.start}, taken` : t.start}
            accessibilityState={{ selected, disabled: t.taken }}
            disabled={t.taken}
            onPress={() => {
              if (!t.taken) book.onSelect({ ...selection, start: t.start });
            }}
            style={[styles.time, selected && styles.timeSelected, t.taken && styles.timeTaken]}>
            <Text
              variant="headline"
              tone={selected ? 'greenInk' : t.taken ? 'inkMuted' : 'ink'}
              tabular
              style={t.taken ? styles.struck : undefined}>
              {t.start}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  tab: { gap: space.xl },
  section: { gap: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  days: { gap: space.sm },
  day: {
    minWidth: MIN_TOUCH + space.md,
    minHeight: MIN_TOUCH + space.lg,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: { backgroundColor: colors.night, borderColor: colors.night },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  time: {
    width: '23%',
    minHeight: MIN_TOUCH,
    borderRadius: radius.control,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeSelected: { backgroundColor: colors.green, borderColor: colors.green },
  timeTaken: { backgroundColor: colors.canvas },
  struck: { textDecorationLine: 'line-through' },
}));
