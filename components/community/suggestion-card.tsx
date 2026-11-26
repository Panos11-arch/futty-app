import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { FollowToggle } from '@/components/community/follow-toggle';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { avatarLook } from '@/lib/avatar';
import type { FollowSuggestion } from '@/lib/community';
import { profileHref } from '@/lib/messages';
import { makeStyles } from '@/lib/theme';
import type { useFollows } from '@/lib/use-follows';

/** "3 matches in common", from the server's count. */
export function inCommonLabel(n: number): string {
  return n === 1 ? '1 match in common' : `${n} matches in common`;
}

/** One "Start following some accounts" card: avatar or initials, name,
 *  matches in common, Follow, and ✕ to dismiss. */
export function SuggestionCard({
  suggestion,
  follows,
  onDismiss,
}: {
  suggestion: FollowSuggestion;
  follows: ReturnType<typeof useFollows>;
  onDismiss: (id: string) => void;
}) {
  const styles = useStyles();
  const inCommon = inCommonLabel(suggestion.matches_in_common);

  return (
    <Card testID={`suggestion-${suggestion.id}`} style={styles.card}>
      <View style={styles.dismiss}>
        <IconButton
          testID={`suggestion-dismiss-${suggestion.id}`}
          icon="xmark"
          size="small"
          tone="inkMuted"
          accessibilityLabel={`Dismiss ${suggestion.full_name}`}
          onPress={() => onDismiss(suggestion.id)}
        />
      </View>
      <Pressable
        testID={`suggestion-open-${suggestion.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${suggestion.full_name}, ${inCommon}`}
        onPress={() => router.push(profileHref(suggestion.id))}
        style={({ pressed }) => [styles.person, pressed && styles.pressed]}>
        <Avatar name={suggestion.full_name} kit={avatarLook(suggestion)} size={MIN_TOUCH + space.md} />
        <Text variant="headline" numberOfLines={1} style={styles.center}>
          {suggestion.full_name}
        </Text>
        <Text variant="caption" tone="inkMuted" numberOfLines={2} style={styles.center}>
          {inCommon}
        </Text>
      </Pressable>
      <FollowToggle
        testID={`suggestion-follow-${suggestion.id}`}
        targetType="player"
        targetId={suggestion.id}
        name={suggestion.full_name}
        follows={follows}
        compact
      />
    </Card>
  );
}

const CARD_WIDTH = MIN_TOUCH * 3 + space.lg;

const useStyles = makeStyles(() => ({
  card: { width: CARD_WIDTH, gap: space.sm, alignItems: 'stretch' },
  dismiss: { position: 'absolute', top: 0, right: 0, zIndex: 1 },
  person: { alignItems: 'center', gap: space.xs, paddingTop: space.sm },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.8 },
}));
