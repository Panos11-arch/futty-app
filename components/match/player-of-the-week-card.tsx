// The Player of the week under the Team of the Week pitch (image 15;
// match-record.md decision 1k item 4.5): avatar, name, games, goals and
// assists, and the rating. No team: a player may play for none. Tapping opens
// the player's profile.
import { router } from 'expo-router';
import { View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { formatRating, playerOfTheWeekLine, type TeamOfTheWeekPlayer } from '@/lib/match/stats-api';
import { makeStyles } from '@/lib/theme';

export function PlayerOfTheWeekCard({ player }: { player: TeamOfTheWeekPlayer }) {
  const styles = useStyles();
  const line = playerOfTheWeekLine(player);
  const rating = formatRating(player.average_rating);
  return (
    <Card
      testID="potw-card"
      onPress={() => router.push({ pathname: '/player-profile', params: { profileId: player.profile_id } })}
      accessibilityLabel={`Player of the week: ${player.name}, ${line}, rating ${rating}`}>
      <View style={styles.row}>
        <View style={styles.ring}>
          <Avatar name={player.name} kit={player.kit} size={64} />
        </View>
        <View style={styles.text}>
          <Text variant="caption" tone="inkMuted" style={styles.kicker}>
            Player of the week
          </Text>
          <Text variant="title" numberOfLines={1}>
            {player.name}
          </Text>
          <Text variant="callout" tone="inkMuted">
            {line}
          </Text>
        </View>
        <View style={styles.rating}>
          <Text variant="number" tabular style={styles.onRating}>
            {rating}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  ring: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.ratingTop,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  text: { flex: 1, gap: space.xs },
  kicker: { textTransform: 'uppercase', letterSpacing: 1 },
  rating: { backgroundColor: colors.ratingTop, borderRadius: radius.chip, paddingHorizontal: space.md },
  onRating: { color: colors.onRatingTop },
}));
