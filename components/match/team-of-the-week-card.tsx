// A team of the week (match-record.md decision 1k): every slot of the
// format's shape, keeper first, with each player's rating and goals and
// assists as the server placed them; a slot with no eligible player says so.
// A player's row opens their profile. S15 draws it on a pitch in Rankings.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import {
  formatRating,
  lineup,
  SLOT_LABELS,
  statLine,
  teamCaption,
  type LineupSlot,
  type TeamOfTheWeek,
  type TeamOfTheWeekPlayer,
  type TeamShape,
} from '@/lib/match/stats-api';

export type TeamOfTheWeekPlayersState =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; players: TeamOfTheWeekPlayer[]; shape: TeamShape | null };

/** "Striker · 4 G · 1 A · Player of the week". */
function subtitle(p: TeamOfTheWeekPlayer): string {
  return [SLOT_LABELS[p.slot], statLine(p), p.player_of_the_week ? 'Player of the week' : '']
    .filter(Boolean)
    .join(' · ');
}

/** "Fotis, Striker, 4 G · 1 A, Player of the week, rating 8.9". */
function accessibilityLabel(p: TeamOfTheWeekPlayer): string {
  return [
    p.name,
    SLOT_LABELS[p.slot],
    statLine(p),
    p.player_of_the_week ? 'Player of the week' : '',
    `rating ${formatRating(p.average_rating)}`,
  ]
    .filter(Boolean)
    .join(', ');
}

export function TeamOfTheWeekCard({
  team,
  state,
  onRetry,
}: {
  team: TeamOfTheWeek;
  state: TeamOfTheWeekPlayersState;
  onRetry: () => void;
}) {
  const slots: LineupSlot[] =
    state.status !== 'ready'
      ? []
      : state.shape
        ? lineup(state.players, state.shape)
        : state.players.map((p) => ({ slot: p.slot, player: p }));
  return (
    <Card padded={false} testID="team-of-the-week-card">
      <View style={styles.header}>
        <Text variant="headline">Team of the week</Text>
        <Text variant="caption" tone="inkMuted">
          {teamCaption(team)}
        </Text>
      </View>
      {state.status === 'loading' ? (
        <View style={styles.pad} testID="team-of-the-week-skeleton">
          <SkeletonText lines={5} />
        </View>
      ) : null}
      {state.status === 'error' ? (
        <View style={styles.pad}>
          <Banner tone="danger" message="Couldn’t load the team." action={{ label: 'Try again', onPress: onRetry }} />
        </View>
      ) : null}
      {slots.map(({ slot, player: p }, i) =>
        p ? (
          <ListRow
            key={p.profile_id}
            testID="team-of-the-week-player"
            title={p.name}
            subtitle={subtitle(p)}
            leading={{ avatar: { name: p.name, kit: p.kit } }}
            accessibilityLabel={accessibilityLabel(p)}
            trailing={
              <Text variant="headline" tabular>
                {formatRating(p.average_rating)}
              </Text>
            }
            chevron
            onPress={() => router.push({ pathname: '/player-profile', params: { profileId: p.profile_id } })}
          />
        ) : (
          <View
            key={`empty-${slot}-${i}`}
            testID="team-of-the-week-empty-slot"
            accessible
            accessibilityLabel={`${SLOT_LABELS[slot]}, No eligible player`}
          >
            <ListRow title="No eligible player" subtitle={SLOT_LABELS[slot]} />
          </View>
        ),
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { padding: space.lg, gap: space.xs },
  pad: { paddingHorizontal: space.lg, paddingBottom: space.lg },
});
