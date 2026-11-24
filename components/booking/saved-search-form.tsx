// Save a search (decided 18 November): a day or a weekday, a time window, a
// game length, a format and a place. Prefilled from the booking search. The
// server checks every rule; this form only collects the choice.
import { useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Banner, Button, Chip, SectionHeader, SegmentedControl, SkeletonBlock, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { PITCH_FORMATS } from '@/lib/booking';
import { dateStrip, dayChipLabel, GAME_LENGTHS, type LoadState } from '@/lib/booking-search';
import {
  gameFits,
  halfHours,
  isoWeekday,
  type SavedSearchDraft,
  type SearchPlace,
  WEEKDAYS,
} from '@/lib/saved-searches';

export type SavedSearchFormProps = {
  initial: SavedSearchDraft;
  /** The server's today and the player's booking window (booking_search_options). */
  today: string;
  windowDays: number;
  places: LoadState<SearchPlace[]>;
  saving: boolean;
  /** The server's refusal, in plain words. */
  error: string | null;
  onSave: (draft: SavedSearchDraft) => void;
};

type DayKind = 'date' | 'weekday';

export function SavedSearchForm({ initial, today, windowDays, places, saving, error, onSave }: SavedSearchFormProps) {
  const styles = useStyles();
  const days = useMemo(() => dateStrip(today, windowDays), [today, windowDays]);
  const times = useMemo(() => halfHours(), []);
  const [kind, setKind] = useState<DayKind>(initial.day ? 'date' : 'weekday');
  const [day, setDay] = useState(initial.day ?? days[0]);
  const [weekday, setWeekday] = useState(initial.weekday ?? isoWeekday(initial.day ?? days[0]));
  const [from, setFrom] = useState(initial.from_local.slice(0, 5));
  const [to, setTo] = useState(initial.to_local.slice(0, 5));
  const [minutes, setMinutes] = useState(initial.minutes);
  const [format, setFormat] = useState<string | null>(initial.format);
  const [place, setPlace] = useState<{ city: string | null; area: string | null }>({ city: initial.city, area: initial.area });

  const draft: SavedSearchDraft = {
    day: kind === 'date' ? day : null,
    weekday: kind === 'weekday' ? weekday : null,
    from_local: from,
    to_local: to,
    minutes,
    format,
    city: place.city,
    area: place.area,
  };
  const fits = gameFits(draft);

  // QA 24 November, bug 10: the From and Until rows open scrolled to the
  // searched time, so it shows as chosen instead of the row's 00:00.
  const fromRow = useRef<ScrollView>(null);
  const toRow = useRef<ScrollView>(null);
  const scrolled = useRef({ from: false, to: false });
  function scrollToChosen(row: 'from' | 'to', x: number) {
    if (scrolled.current[row]) return;
    scrolled.current[row] = true;
    (row === 'from' ? fromRow : toRow).current?.scrollTo({ x: Math.max(0, x - space.xl), animated: false });
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text variant="body" tone="inkMuted">
        We’ll tell you once a day at most when a pitch like this frees up or a game like this needs players.
      </Text>

      <View style={styles.section}>
        <SectionHeader title="Day" />
        <SegmentedControl
          accessibilityLabel="One day or every week"
          options={[
            { value: 'date', label: 'One day' },
            { value: 'weekday', label: 'Every week' },
          ]}
          value={kind}
          onChange={(v) => setKind(v as DayKind)}
        />
        {kind === 'date' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {days.map((d) => (
              <Chip key={d} label={dayChipLabel(d, today)} selected={d === day} onPress={() => setDay(d)} />
            ))}
          </ScrollView>
        ) : (
          <View style={styles.wrap}>
            {WEEKDAYS.map((name, i) => (
              <Chip key={name} label={name.slice(0, 3)} selected={weekday === i + 1} onPress={() => setWeekday(i + 1)} />
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader title="From" />
        <ScrollView
          ref={fromRow}
          testID="saved-search-from"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {times.slice(0, -1).map((t) => (
            <View key={t} onLayout={t === from ? (e) => scrollToChosen('from', e.nativeEvent.layout.x) : undefined}>
              <Chip testID={`from-${t}`} label={t} tabular selected={t === from} onPress={() => setFrom(t)} />
            </View>
          ))}
        </ScrollView>
        <SectionHeader title="Until" />
        <ScrollView
          ref={toRow}
          testID="saved-search-to"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {times.slice(1).map((t) => (
            <View key={t} onLayout={t === to ? (e) => scrollToChosen('to', e.nativeEvent.layout.x) : undefined}>
              <Chip testID={`to-${t}`} label={t} tabular selected={t === to} onPress={() => setTo(t)} />
            </View>
          ))}
        </ScrollView>
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
          <Chip label="Any" selected={format === null} onPress={() => setFormat(null)} />
          {PITCH_FORMATS.map((f) => (
            <Chip key={f} label={f} selected={f === format} onPress={() => setFormat(f)} />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Where" />
        {places.status === 'loading' ? <SkeletonBlock width="100%" height={48} /> : null}
        {places.status === 'error' ? (
          <Text variant="body" tone="inkMuted">
            {places.message}
          </Text>
        ) : null}
        {places.status === 'ready' ? (
          <View style={styles.wrap}>
            <Chip
              label="Anywhere"
              selected={!place.city && !place.area}
              onPress={() => setPlace({ city: null, area: null })}
            />
            {places.data.flatMap((p) => [
              <Chip
                key={p.city}
                label={`All of ${p.city}`}
                selected={place.city === p.city}
                onPress={() => setPlace({ city: p.city, area: null })}
              />,
              ...p.areas.map((a) => (
                <Chip key={a} label={a} selected={place.area === a} onPress={() => setPlace({ city: null, area: a })} />
              )),
            ])}
          </View>
        ) : null}
      </View>

      {!fits ? (
        <Text variant="body" tone="danger">
          A {minutes}-minute game doesn’t fit between {from} and {to}.
        </Text>
      ) : null}
      {error ? <Banner tone="danger" message={error} /> : null}

      <Button label="Save this search" onPress={() => onSave(draft)} disabled={!fits} loading={saving} fullWidth />
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
  row: { gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
