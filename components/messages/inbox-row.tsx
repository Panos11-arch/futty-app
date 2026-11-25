import { Pressable, View } from 'react-native';

import { UnreadBadge } from '@/components/messages/unread-badge';
import { Avatar } from '@/components/ui/avatar';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { inboxTime, kitOf, type InboxRow as Row } from '@/lib/messages';
import { makeStyles } from '@/lib/theme';

export type InboxRowProps = {
  row: Row;
  onOpen: () => void;
  /** The avatar opens their profile. */
  onOpenProfile?: () => void;
  now?: Date;
};

/** Avatar, name, team, the last message, its time and the unread count. */
export function InboxRow({ row, onOpen, onOpenProfile, now }: InboxRowProps) {
  const styles = useStyles();
  const unread = row.unread > 0;
  const preview = row.last_mine ? `You: ${row.last_body}` : row.last_body;
  const label = [
    row.title,
    row.subtitle,
    preview,
    inboxTime(row.last_at, now),
    unread ? `${row.unread} unread` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.row}>
      <Pressable
        testID={`inbox-avatar-${row.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${row.title}, profile`}
        onPress={onOpenProfile}
        disabled={!onOpenProfile}
        style={styles.avatar}>
        <Avatar name={row.title} kit={kitOf(row)} />
      </Pressable>
      <Pressable
        testID={`inbox-row-${row.id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onOpen}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
        <View style={styles.text}>
          <View style={styles.line}>
            <Text variant="headline" numberOfLines={1} style={styles.flex}>
              {row.title}
            </Text>
            <Text variant="caption" tone={unread ? 'ink' : 'inkMuted'} tabular>
              {inboxTime(row.last_at, now)}
            </Text>
          </View>
          {row.subtitle && row.subtitle !== row.title ? (
            <Text variant="caption" tone="inkMuted" numberOfLines={1}>
              {row.subtitle}
            </Text>
          ) : null}
          <View style={styles.line}>
            <Text variant="callout" tone={unread ? 'ink' : 'inkMuted'} numberOfLines={1} style={styles.flex}>
              {preview}
            </Text>
            <UnreadBadge count={row.unread} testID={`inbox-unread-${row.id}`} />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  avatar: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minHeight: MIN_TOUCH },
  pressed: { opacity: 0.8 },
  text: { flex: 1, gap: space.xs / 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
}));
