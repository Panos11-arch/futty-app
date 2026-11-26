// S7 (image 18): a confirmed result of a followed team or player. The score
// only: no ratings or goals here. Share makes the match's story card.
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ActorRow } from '@/components/community/actor-row';
import { Pill } from '@/components/community/pill';
import { ResultShare } from '@/components/community/result-share';
import { Card } from '@/components/ui/card';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import type { MatchResultItem } from '@/lib/community';
import { resultSubtitle, scoreLabel, scoreText } from '@/lib/community-feed';
import { teamHref } from '@/lib/messages';
import { makeStyles } from '@/lib/theme';

function SideName({ label, teamId, align }: { label: string; teamId: string | null; align: 'left' | 'right' }) {
  const styles = useStyles();
  const text = (
    <Text variant="headline" tone="onNight" numberOfLines={2} style={align === 'right' ? styles.right : undefined}>
      {label}
    </Text>
  );
  if (!teamId) return <View style={styles.side}>{text}</View>;
  return (
    <Pressable
      testID={`feed-result-team-${teamId}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(teamHref(teamId))}
      style={({ pressed }) => [styles.side, pressed && styles.pressed]}>
      {text}
    </Pressable>
  );
}

export function MatchResultCard({ item, now }: { item: MatchResultItem; now?: Date }) {
  const styles = useStyles();
  return (
    <Card testID={`feed-result-${item.item_id}`} style={styles.card}>
      <ActorRow
        item={item}
        subtitle={resultSubtitle(item, now)}
        pill={item.league ? <Pill label="League" testID={`feed-result-league-${item.item_id}`} /> : null}
      />
      <View style={styles.panel} accessible={false}>
        <SideName label={item.side_a_label} teamId={item.side_a_team_id} align="left" />
        <Text variant="number" tone="onNight" tabular accessibilityLabel={scoreLabel(item)}>
          {scoreText(item)}
        </Text>
        <SideName label={item.side_b_label} teamId={item.side_b_team_id} align="right" />
      </View>
      {/* A forfeit has no score, so no story card. */}
      {item.forfeit_side ? null : <ResultShare matchId={item.item_id} />}
    </Card>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  card: { gap: space.md },
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.control,
    backgroundColor: colors.night,
  },
  side: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center' },
  right: { textAlign: 'right' },
  pressed: { opacity: 0.8 },
}));
