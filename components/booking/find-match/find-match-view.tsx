// Find a match (S6; image 05; Playtomic 15, 16): "Search for a venue or
// town", one filter chip "Format | Places | Dates and times", then the open
// games by Cyprus day. With no filters yet: an illustration, "No filters
// yet", one line and "Set filters". "Start a match" opens Book a pitch.
import { useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, RefreshControl, SectionList, View } from 'react-native';

import { MissingVenueSheet } from '@/components/booking/book-search/missing-venue-sheet';
import { WherePicker } from '@/components/booking/book-search/where-picker';
import { MatchCard } from '@/components/booking/find-match/match-card';
import { MatchFilterSheet } from '@/components/booking/find-match/match-filter-sheet';
import { Banner, Button, EmptyState, SkeletonBlock, StickyActionBar, Text } from '@/components/ui';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { radius, space } from '@/constants/futty-theme';
import type { BookPlace, LoadState, PlaceVenue } from '@/lib/booking-search';
import { filtersChipLabel, type MatchCard as MatchCardData, type MatchFilters, type MatchSection } from '@/lib/find-match';
import { makeStyles, useTheme } from '@/lib/theme';

export type FindMatchViewProps = {
  /** The server's today (Cyprus) and booking window; null until loaded. */
  today: string | null;
  windowDays: number;
  towns: string[];
  venues: PlaceVenue[];
  recents: BookPlace[];
  /** Null: no filters yet. */
  filters: MatchFilters | null;
  /** Null while there are no filters. */
  results: LoadState<MatchSection[]> | null;
  refreshing: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onApplyFilters: (filters: MatchFilters) => void;
  onPickPlace: (place: BookPlace) => void;
  onRequestVenue: (venueName: string, town: string) => Promise<void>;
  onOpenCard: (card: MatchCardData) => void;
  onOpenPlayer: (profileId: string) => void;
  onOpenTeam: (teamId: string) => void;
  onStartMatch: () => void;
};

type Open = 'filters' | 'where' | 'missing' | null;

function Skeletons() {
  const styles = useStyles();
  return (
    <View testID="find-match-skeleton" style={styles.skeletons}>
      <SkeletonBlock width="40%" height={ICON.small} />
      <SkeletonBlock width="100%" height={120} />
      <SkeletonBlock width="100%" height={120} />
      <SkeletonBlock width="100%" height={120} />
    </View>
  );
}

/** The empty-filters picture: built from tokens and an icon, no image file. */
function Illustration() {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.artPitch}>
        <IconSymbol name="soccerball" size={ICON.regular * 3} color={colors.ink} />
      </View>
    </View>
  );
}

export function FindMatchView({
  today,
  windowDays,
  towns,
  venues,
  recents,
  filters,
  results,
  refreshing,
  onRefresh,
  onRetry,
  onApplyFilters,
  onPickPlace,
  onRequestVenue,
  onOpenCard,
  onOpenPlayer,
  onOpenTeam,
  onStartMatch,
}: FindMatchViewProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState<Open>(null);
  const [sent, setSent] = useState(false);
  const missingAfterPicker = useRef(false);
  const close = () => setOpen(null);
  const chip = filtersChipLabel(filters, today ?? '');
  const sections = results?.status === 'ready' ? results.data : [];

  const header = (
    <View style={styles.top}>
      <Pressable
        testID="find-match-search"
        accessibilityRole="search"
        accessibilityLabel="Search for a venue or town"
        onPress={() => setOpen('where')}
        style={styles.field}>
        <IconSymbol name="magnifyingglass" size={ICON.small} color={colors.inkMuted} />
        <Text variant="body" tone="inkMuted" numberOfLines={1} style={styles.grow}>
          Search for a venue or town
        </Text>
      </Pressable>
      <View style={styles.chipRow}>
        <Pressable
          testID="find-match-filters"
          accessibilityRole="button"
          accessibilityLabel={`Filters: ${chip}`}
          disabled={!today}
          onPress={() => setOpen('filters')}
          style={styles.chip}>
          <Text variant="callout" numberOfLines={1} style={styles.chipText}>
            {chip}
          </Text>
          <IconSymbol name="chevron.down" size={ICON.small} color={colors.ink} />
        </Pressable>
      </View>
      {sent ? <Banner tone="info" message="Venue sent" /> : null}
    </View>
  );

  let body: ReactNode;
  if (!filters) {
    body = (
      <View testID="find-match-no-filters" style={styles.noFilters}>
        <Illustration />
        <Text variant="title" accessibilityRole="header" style={styles.centre}>
          No filters yet
        </Text>
        <Text variant="body" tone="inkMuted" style={styles.centre}>
          Pick a format, place and time.
        </Text>
        <Button testID="find-match-set-filters" label="Set filters" onPress={() => setOpen('filters')} disabled={!today} />
      </View>
    );
  } else if (results?.status === 'error') {
    body = (
      <View testID="find-match-error">
        <EmptyState icon="exclamationmark.circle.fill" message={results.message} action={{ label: 'Try again', onPress: onRetry }} />
      </View>
    );
  } else if (!results || (results.status === 'loading' && !refreshing)) {
    body = <Skeletons />;
  }

  return (
    <View testID="find-match-screen" style={styles.screen}>
      {body !== undefined ? (
        <View style={styles.flex}>
          {header}
          {body}
        </View>
      ) : (
        <SectionList
          testID="find-match-list"
          sections={sections}
          keyExtractor={(card) => card.post_id}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderSectionHeader={({ section }) => (
            <Text testID={`find-match-day-${section.day}`} variant="caption" tone="inkMuted" accessibilityRole="header" style={styles.day}>
              {section.title.toUpperCase()}
            </Text>
          )}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <MatchCard
                card={item}
                onOpen={() => onOpenCard(item)}
                onOpenPlayer={onOpenPlayer}
                onOpenTeam={onOpenTeam}
              />
            </View>
          )}
          ListEmptyComponent={
            <View testID="find-match-empty">
              <EmptyState icon="sportscourt.fill" message="No open games" action={{ label: 'Change filters', onPress: () => setOpen('filters') }} />
            </View>
          }
        />
      )}

      <StickyActionBar actionTestID="find-match-start" actionLabel="Start a match" onPress={onStartMatch} />

      {today ? (
        <MatchFilterSheet
          visible={open === 'filters'}
          onClose={close}
          initial={filters}
          today={today}
          windowDays={windowDays}
          towns={towns}
          venues={venues}
          onApply={(next) => {
            close();
            onApplyFilters(next);
          }}
        />
      ) : null}
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
  flex: { flex: 1 },
  grow: { flex: 1 },
  centre: { textAlign: 'center' },
  top: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.md,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.fill,
    borderRadius: radius.control,
    minHeight: MIN_TOUCH + space.sm,
    paddingHorizontal: space.lg,
  },
  chipRow: { flexDirection: 'row' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TOUCH,
    maxWidth: '100%',
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipText: { flexShrink: 1 },
  list: { paddingBottom: space.xxl },
  day: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  item: { paddingHorizontal: space.lg, paddingBottom: space.md },
  skeletons: { padding: space.lg, gap: space.md },
  noFilters: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  art: {
    width: space.xxl * 4,
    height: space.xxl * 3,
    borderRadius: radius.card,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artPitch: {
    width: space.xxl * 2,
    height: space.xxl * 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
