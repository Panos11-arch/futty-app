// Scorers and assists on the match page (match-record.md 4.6, 5.3; S13B).
// Everyone who can see the page sees each side's scorers with their goals
// and assisters with their assists. Captains log and correct them on the
// after-game screens, not here. A name opens the player's profile.
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { space } from '@/constants/futty-theme';
import { playerName, sideOf, sideTallies, type MatchPage, type RosterPlayer, type Tallied } from '@/lib/match/page';
import type { Side } from '@/lib/match/types';
import type { Loadable } from '@/lib/match/use-match-result';

export type RosterState = Loadable<{ roster: RosterPlayer[] }>;

export function MatchScorers({ page }: { page: MatchPage }) {
  const sides = (['a', 'b'] as Side[]).map((side) => ({ side, ...sideTallies(page, side) }));
  if (sides.every((s) => s.goals.length === 0)) {
    return (
      <Text variant="callout" tone="inkMuted" testID="scorers">
        No scorers yet
      </Text>
    );
  }
  return (
    <View style={styles.wrap} testID="scorers">
      {sides.map(({ side, goals, assists }) =>
        goals.length === 0 ? null : (
          <View key={side} style={styles.side} testID={`scorers-${side}`}>
            <Text variant="headline">{sideOf(page, side).label}</Text>
            {goals.map((row) => (
              <Row key={`g-${row.key}`} row={row} testID={`scorer-${row.key}`} />
            ))}
            {assists.length > 0 ? (
              <Text variant="caption" tone="inkMuted">
                Assists
              </Text>
            ) : null}
            {assists.map((row) => (
              <Row key={`a-${row.key}`} row={row} testID={`assister-${row.key}`} />
            ))}
          </View>
        )
      )}
    </View>
  );
}

function Row({ row, testID }: { row: Tallied; testID: string }) {
  const name = playerName(row.player);
  const profileId = row.player?.profileId ?? null;
  const content = (
    <>
      <Text variant="body" style={styles.name}>
        {name}
      </Text>
      <Text variant="headline" tabular>
        {String(row.count)}
      </Text>
    </>
  );
  if (!profileId) {
    return (
      <View style={styles.row} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      style={styles.row}
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={`${name}, ${row.count}`}
      onPress={() => router.push({ pathname: '/player-profile', params: { profileId } })}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  side: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH },
  name: { flexShrink: 1 },
});
