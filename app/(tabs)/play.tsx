import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { isLeaguesSegment, parsePlaySegment, PLAY_SEGMENTS, type PlaySegment } from '@/lib/play-segments';

import { PreviousGamesList } from '../previous-games';
import { UpcomingFixturesList } from '../upcoming-fixtures';
import { TeamContent } from './team';

const SEGMENT_OPTIONS = PLAY_SEGMENTS.map(({ value, label }) => ({ value, label }));

function withSegment(opened: ReadonlySet<PlaySegment>, segment: PlaySegment) {
  return opened.has(segment) ? opened : new Set(opened).add(segment);
}

/** Fixtures still to play and past games to log, in one scroller. */
function MatchesContent() {
  const styles = useStyles();
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
 * Play: teams and matches (docs/specs/15-design.md section 0.9). Not a tab
 * since S2: Account → Play opens it, and the tab layout's header shows its
 * name. The segments stay fixed; each segment's content scrolls itself, so a
 * list inside one is never nested in another scroller. Links to /team
 * redirect here with ?segment=; Leagues is its own screen since S9, so an old
 * ?segment=leagues link opens /leagues.
 */
export default function PlayScreen() {
  const params = useLocalSearchParams<{ segment?: string; teamId?: string }>();
  if (isLeaguesSegment(params.segment)) return <Redirect href="/leagues" />;
  return <PlaySegments segment={params.segment} teamId={params.teamId} />;
}

function PlaySegments({ segment: rawSegment, teamId }: { segment?: string; teamId?: string }) {
  const styles = useStyles();
  const params = { segment: rawSegment, teamId };
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
    <View testID="play-screen" style={styles.screen}>
      <View style={styles.header}>
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
          </View>
        ) : null
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
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
}));
