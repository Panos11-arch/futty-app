// S8 Profile tab, "Recent games" (image 19): the newest games from
// my_profile_recent. Each row: the result, "Side 4 : 1 Side", venue and
// day, the player's goals and assists, and the rating when it may be shown.
// A row opens the match page; a named team opens its team page; "All
// games" opens Previous games (spec 15 section 0.9). Hidden with no games.
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { FormChip } from '@/components/match/form-chips';
import { RatingBadge } from '@/components/match/rating-badge';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { goalsAssistsLabel, recentGameWhere, type ProfileRecentGame } from '@/lib/match/profile-summary-api';
import type { Loadable } from '@/lib/match/use-match-result';
import { makeStyles } from '@/lib/theme';

export type ProfileRecentGamesProps = {
  state: Loadable<{ games: ProfileRecentGame[] }>;
  onRetry: () => void;
};

const openTeam = (teamId: string) => router.push({ pathname: '/team-profile', params: { teamId } });

function TeamName({ name, teamId }: { name: string; teamId: string | null }) {
  const styles = useStyles();
  if (!teamId) return <Text variant="body">{name}</Text>;
  return (
    <Pressable
      testID="profile-recent-team"
      accessibilityRole="link"
      accessibilityLabel={`Open ${name}`}
      onPress={() => openTeam(teamId)}
      hitSlop={space.sm}
      style={({ pressed }) => pressed && styles.pressed}>
      <Text variant="body">{name}</Text>
    </Pressable>
  );
}

function GameRow({ game }: { game: ProfileRecentGame }) {
  const styles = useStyles();
  const ga = goalsAssistsLabel(game.goals, game.assists);
  const score = `${game.goals_for ?? '–'} : ${game.goals_against ?? '–'}`;
  const where = recentGameWhere(game);
  return (
    <Pressable
      testID="profile-recent-row"
      accessibilityRole="button"
      accessibilityLabel={`${game.label} ${score} ${game.opponent_label}, ${where}${ga ? `, ${ga}` : ''}`}
      onPress={() => router.push({ pathname: '/match/[id]', params: { id: game.match_id } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <FormChip result={game.result} />
      <View style={styles.middle}>
        <View style={styles.scoreLine}>
          <TeamName name={game.label} teamId={game.team_id} />
          <Text variant="body" tabular>
            {score}
          </Text>
          <TeamName name={game.opponent_label} teamId={game.opponent_team_id} />
        </View>
        {where ? (
          <Text variant="callout" tone="inkMuted" numberOfLines={1}>
            {where}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        {ga ? (
          <Text variant="callout" tone="inkMuted" tabular>
            {ga}
          </Text>
        ) : null}
        {game.rating !== null ? <RatingBadge rating={game.rating} testID="profile-recent-rating" /> : null}
      </View>
    </Pressable>
  );
}

export function ProfileRecentGames({ state, onRetry }: ProfileRecentGamesProps) {
  const styles = useStyles();
  if (state.status === 'ready' && state.games.length === 0) return null;
  return (
    <Card style={styles.card} testID="profile-recent">
      <Text variant="headline" accessibilityRole="header">
        Recent games
      </Text>
      {state.status === 'loading' ? (
        <View testID="profile-recent-skeleton">
          <SkeletonText lines={3} />
        </View>
      ) : state.status === 'error' ? (
        <Banner tone="danger" message="Recent games couldn’t load." action={{ label: 'Try again', onPress: onRetry }} />
      ) : (
        <>
          {state.games.map((g) => (
            <GameRow key={g.match_id} game={g} />
          ))}
          <Pressable
            testID="profile-all-games"
            accessibilityRole="button"
            accessibilityLabel="All games"
            onPress={() => router.push('/previous-games')}
            style={({ pressed }) => [styles.allGames, pressed && styles.pressed]}>
            <Text variant="headline">All games ›</Text>
          </Pressable>
        </>
      )}
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH },
  middle: { flex: 1, gap: space.xs / 2 },
  scoreLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.xs },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  allGames: { alignSelf: 'center', minHeight: MIN_TOUCH, justifyContent: 'center' },
  pressed: { opacity: 0.8 },
}));
