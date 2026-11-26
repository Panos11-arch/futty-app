import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, View } from 'react-native';

import { FixtureGroupCard } from '@/components/match/fixture-group-card';
import { MatchesFilterSheet } from '@/components/match/matches-filter-sheet';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Sheet } from '@/components/ui/sheet';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { dateKeyToDate, dayLabel, toDateKey } from '@/lib/days';
import {
  filterDayFixtures,
  groupFixturesByCompetition,
  shiftDayKey,
  type FixtureGroup,
  type MatchesFilter,
} from '@/lib/match/day-fixtures';
import { useDayFixtures } from '@/lib/match/use-day-fixtures';
import { makeStyles, useTheme } from '@/lib/theme';

/** The calendar day a picker shows for "YYYY-MM-DD" (noon, so no clock change moves it). */
function pickerDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export type MatchesTabProps = {
  /** Today in Cyprus (YYYY-MM-DD). */
  today: string;
  myTeamIds: Set<string>;
  pinnedKeys: Set<string>;
  /** Competition names by key, from the league directory. */
  names: Map<string, string>;
  cities: { scope: string; label: string }[];
  onTogglePin: (group: FixtureGroup) => void;
};

/** The MATCHES tab (sofascore-05): Filter, ◂ day ▸ with a date picker, and
 *  that day's league fixtures by competition, my teams first. The Live
 *  toggle waits for fixtures to have a live state. */
export function MatchesTab({ today, myTeamIds, pinnedKeys, names, cities, onTogglePin }: MatchesTabProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [day, setDay] = useState(today);
  const [filter, setFilter] = useState<MatchesFilter>({ format: null, scope: null });
  const [filterOpen, setFilterOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fixtures = useDayFixtures(day);

  const groups = useMemo(
    () =>
      fixtures.status === 'ready'
        ? groupFixturesByCompetition(filterDayFixtures(fixtures.fixtures, filter), { myTeamIds, pinnedKeys, names })
        : [],
    [fixtures, filter, myTeamIds, pinnedKeys, names],
  );

  const filterCount = (filter.format ? 1 : 0) + (filter.scope ? 1 : 0);
  const label = dayLabel(dateKeyToDate(day));

  function openPicker() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: pickerDate(day),
        mode: 'date',
        onChange: (event, picked) => {
          if (event.type === 'set' && picked) setDay(toDateKey(picked));
        },
      });
    } else {
      setPickerOpen(true);
    }
  }

  const toolbar = (
    <View style={styles.toolbar}>
      <Pressable
        testID="matches-filter"
        accessibilityRole="button"
        accessibilityLabel={filterCount ? `Filter, ${filterCount} on` : 'Filter'}
        onPress={() => setFilterOpen(true)}
        style={({ pressed }) => [styles.pill, filterCount > 0 && styles.pillOn, pressed && styles.pressed]}>
        <Text variant="callout">{filterCount ? `Filter (${filterCount})` : 'Filter'}</Text>
      </Pressable>
      <View style={[styles.pill, styles.stepper]}>
        <Pressable
          testID="matches-day-prev"
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          onPress={() => setDay((d) => shiftDayKey(d, -1))}
          style={styles.step}>
          <IconSymbol name="chevron.left" size={ICON.small} color={colors.ink} />
        </Pressable>
        <Pressable
          testID="matches-day"
          accessibilityRole="button"
          accessibilityLabel={`${label}, pick a day`}
          onPress={openPicker}
          style={styles.dayLabel}>
          <Text variant="callout" numberOfLines={1}>
            {label}
          </Text>
        </Pressable>
        <Pressable
          testID="matches-day-next"
          accessibilityRole="button"
          accessibilityLabel="Next day"
          onPress={() => setDay((d) => shiftDayKey(d, 1))}
          style={styles.step}>
          <IconSymbol name="chevron.right" size={ICON.small} color={colors.ink} />
        </Pressable>
      </View>
    </View>
  );

  let body: React.ReactNode;
  if (fixtures.status === 'loading') {
    body = (
      <View style={styles.pad}>
        <Card testID="matches-skeleton">
          <SkeletonText lines={5} />
        </Card>
      </View>
    );
  } else if (fixtures.status === 'error') {
    body = (
      <View style={styles.pad}>
        <Banner tone="danger" message="Could not load matches." action={{ label: 'Try again', onPress: fixtures.reload }} />
      </View>
    );
  } else {
    body = (
      <FlatList
        testID="matches-list"
        data={groups}
        keyExtractor={(g) => g.key}
        renderItem={({ item }) => (
          <FixtureGroupCard
            group={item}
            myTeamIds={myTeamIds}
            onTogglePin={() => onTogglePin(item)}
            onOpenFixture={(fixtureId) => router.push({ pathname: '/fixture-chat', params: { fixtureId } })}
            onOpenTeam={(teamId) => router.push({ pathname: '/team-profile', params: { teamId } })}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        ListEmptyComponent={
          <EmptyState icon="calendar" message="No matches" action={{ label: 'Next day', onPress: () => setDay((d) => shiftDayKey(d, 1)) }} />
        }
        refreshControl={<RefreshControl refreshing={fixtures.refreshing} onRefresh={fixtures.refresh} tintColor={colors.inkMuted} />}
        contentContainerStyle={styles.list}
      />
    );
  }

  return (
    <View style={styles.flex}>
      {toolbar}
      {body}
      <MatchesFilterSheet
        visible={filterOpen}
        value={filter}
        cities={cities}
        onApply={(next) => {
          setFilter(next);
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
      />
      {Platform.OS !== 'android' ? (
        <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Pick a day">
          <DateTimePicker
            testID="matches-day-picker"
            value={pickerDate(day)}
            mode="date"
            display="inline"
            onChange={(event, picked) => {
              if (event.type === 'set' && picked) {
                setDay(toDateKey(picked));
                setPickerOpen(false);
              }
            }}
          />
        </Sheet>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  flex: { flex: 1 },
  toolbar: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  pill: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillOn: { backgroundColor: colors.greenSoft },
  stepper: { flex: 1, flexDirection: 'row', paddingHorizontal: 0 },
  step: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  dayLabel: { flex: 1, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  pad: { padding: space.lg },
  list: { padding: space.lg, paddingTop: 0, paddingBottom: space.xxl, flexGrow: 1 },
  gap: { height: space.md },
}));
