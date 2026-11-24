// Player ratings on the match page (S13B): every player who checked in gets
// a rating from the match's stats, the same for every player (no positions),
// shown as a coloured badge, best first. The 1–10 rating votes are gone.
// A name opens the player's profile.
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { RatingBadge } from '@/components/match/rating-badge';
import { Text } from '@/components/ui/text';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { space } from '@/constants/futty-theme';
import { playerName, sideOf, type MatchPage } from '@/lib/match/page';

export function MatchRatingsList({ page }: { page: Pick<MatchPage, 'ratings' | 'sides'> }) {
  if (page.ratings.length === 0) {
    return (
      <Text variant="callout" tone="inkMuted" testID="ratings-result">
        No ratings
      </Text>
    );
  }
  return (
    <View testID="ratings-result">
      {page.ratings.map((r) => {
        const name = playerName(r);
        const side = sideOf(page, r.side).label;
        return (
          <Pressable
            key={r.playerId}
            style={styles.row}
            testID={`rating-${r.playerId}`}
            accessibilityRole="link"
            accessibilityLabel={`${name}, ${side}, rating ${Number(r.rating).toFixed(1)}`}
            disabled={!r.profileId}
            onPress={() => r.profileId && router.push({ pathname: '/player-profile', params: { profileId: r.profileId } })}>
            <View style={styles.who}>
              <Text variant="body" numberOfLines={1}>
                {name}
              </Text>
              <Text variant="caption" tone="inkMuted">
                {side}
              </Text>
            </View>
            <RatingBadge rating={Number(r.rating)} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH, gap: space.md },
  who: { flexShrink: 1 },
});
