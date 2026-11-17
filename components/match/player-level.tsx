// A player's skill level where the XP bar used to be (docs/specs/match-
// record.md decision 1f.6; 05-product section 4): the level with one
// decimal, a "Provisional" tag until 5 competitive matches, and the
// reliability %. "No level yet" for a player with no player_levels row. On
// the viewer's own profile, while the five starting questions can still be
// answered, a button opens them.
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';
import { formatLevel, startingLevelOffered, type PlayerLevel } from '@/lib/match/levels';
import type { Loadable } from '@/lib/match/use-match-result';
import { STARTING_LEVEL_ROUTE, usePlayerLevel } from '@/lib/match/use-levels';

export type PlayerLevelViewProps = {
  state: Loadable<{ level: PlayerLevel | null }>;
  onRetry: () => void;
  /** The viewer's own profile: offers the starting questions while they can be answered. */
  own?: boolean;
};

const openQuestions = () => router.push(STARTING_LEVEL_ROUTE);

export function PlayerLevelView({ state, onRetry, own = false }: PlayerLevelViewProps) {
  if (state.status === 'loading') {
    return (
      <View testID="player-level-skeleton">
        <SkeletonText lines={2} />
      </View>
    );
  }
  if (state.status === 'error') {
    return <Banner tone="danger" message="Could not load the level." action={{ label: 'Try again', onPress: onRetry }} />;
  }

  const { level } = state;
  const offer = own && startingLevelOffered(level) ? (
    <Button
      label="Set your starting level"
      variant="secondary"
      onPress={openQuestions}
      fullWidth
      testID="set-starting-level"
    />
  ) : null;

  if (!level) {
    return (
      <View style={styles.stack} testID="player-level">
        <Text variant="callout" tone="inkMuted">
          No level yet
        </Text>
        {offer}
      </View>
    );
  }

  const shown = formatLevel(level.level);
  return (
    <View style={styles.stack} testID="player-level">
      <View
        style={styles.row}
        accessible
        accessibilityLabel={`Level ${shown}${level.provisional ? ', provisional' : ''}, reliability ${level.reliabilityPct}%`}>
        <Text variant="caption" tone="inkMuted">
          Level
        </Text>
        <Text variant="title" tabular testID="player-level-value">
          {shown}
        </Text>
        {level.provisional ? (
          <View style={styles.tag} testID="player-level-provisional">
            <Text variant="caption">Provisional</Text>
          </View>
        ) : null}
      </View>
      <Text variant="caption" tone="inkMuted" tabular>
        {`Reliability ${level.reliabilityPct}%`}
      </Text>
      {offer}
    </View>
  );
}

/** Loads the level and reloads it whenever the screen comes back into focus (after the questions). */
export function PlayerLevelSummary({ profileId, own = false }: { profileId: string; own?: boolean }) {
  const level = usePlayerLevel(profileId);
  const { reload } = level;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );
  return <PlayerLevelView state={level} onRetry={reload} own={own} />;
}

const styles = StyleSheet.create({
  stack: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  tag: {
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs / 2,
  },
});
