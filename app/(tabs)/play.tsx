import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';
import { parsePlaySegment, PLAY_SEGMENTS, type PlaySegment } from '@/lib/play-segments';

import { PreviousGamesList } from '../previous-games';
import { UpcomingFixturesList } from '../upcoming-fixtures';
import { CommunityContent } from './community';
import { LeaguesContent } from './leagues';
import { TeamContent } from './team';

const SEGMENT_OPTIONS = PLAY_SEGMENTS.map(({ value, label }) => ({ value, label }));

function withSegment(opened: ReadonlySet<PlaySegment>, segment: PlaySegment) {
  return opened.has(segment) ? opened : new Set(opened).add(segment);
}

/** Fixtures still to play and past games to log, in one scroller. */
function MatchesContent() {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.matches}>
      <SectionHeader title="Upcoming fixtures" />
      <UpcomingFixturesList />
      <SectionHeader title="Previous games" />
      <PreviousGamesList />
    </ScrollView>
  );
}

/**
 * Play: teams, matches, leagues and community (docs/specs/15-design.md
 * section 4). The title and segments stay fixed; each segment's content
 * scrolls itself, so a list inside one is never nested in another scroller.
 * Links to /team, /leagues and /community redirect here with ?segment=.
 */
export default function PlayScreen() {
  const params = useLocalSearchParams<{ segment?: string; teamId?: string }>();
  const fromUrl = parsePlaySegment(params.segment);
  const [segment, setSegment] = useState<PlaySegment>(fromUrl);
  // Once opened, a segment stays mounted (hidden when not selected), so
  // switching back doesn't refetch everything; see community.tsx.
  const [opened, setOpened] = useState<ReadonlySet<PlaySegment>>(() => new Set([fromUrl]));

  // Play stays mounted as a tab, so a redirect arriving later only changes
  // the param.
  useEffect(() => {
    setSegment(fromUrl);
    setOpened((prev) => withSegment(prev, fromUrl));
  }, [fromUrl]);

  function choose(next: PlaySegment) {
    setSegment(next);
    setOpened((prev) => withSegment(prev, next));
    // Keep the URL in step, so a later link to the segment it named before
    // still counts as a change.
    router.setParams({ segment: next });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text variant={Platform.OS === 'ios' ? 'display' : 'title'} accessibilityRole="header">
          Play
        </Text>
        <SegmentedControl
          options={SEGMENT_OPTIONS}
          value={segment}
          onChange={choose}
          accessibilityLabel="Play section"
        />
      </View>

      {PLAY_SEGMENTS.map(({ value }) =>
        opened.has(value) ? (
          <View
            key={value}
            testID={`play-segment-${value}`}
            style={value === segment ? styles.flex : styles.hidden}>
            {value === 'teams' ? <TeamContent teamId={params.teamId} /> : null}
            {value === 'matches' ? <MatchesContent /> : null}
            {value === 'leagues' ? <LeaguesContent /> : null}
            {value === 'community' ? <CommunityContent /> : null}
          </View>
        ) : null
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.md,
  },
  flex: { flex: 1 },
  hidden: { display: 'none' },
  matches: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
});
