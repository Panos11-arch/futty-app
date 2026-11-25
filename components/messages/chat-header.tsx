import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { hairline, space } from '@/constants/futty-theme';
import type { AvatarKit } from '@/lib/avatar';
import { makeStyles } from '@/lib/theme';

export type ChatHeaderProps = {
  title: string;
  subtitle?: string | null;
  kit?: AvatarKit | null;
  onBack: () => void;
  /** Opens the profile (or the team, when the title is the team). */
  onOpenTitle?: () => void;
  /** Opens the team page from the line under the name. */
  onOpenSubtitle?: () => void;
  /** The ⋯ menu: Report, Block. */
  onMore?: () => void;
};

/** Back, avatar, name with the team under it, and ⋯. */
export function ChatHeader({ title, subtitle, kit, onBack, onOpenTitle, onOpenSubtitle, onMore }: ChatHeaderProps) {
  const styles = useStyles();
  return (
    <View style={styles.bar}>
      <IconButton testID="chat-back" icon="chevron.left" accessibilityLabel="Back" onPress={onBack} />
      <Pressable
        testID="chat-header-name"
        accessibilityRole={onOpenTitle ? 'button' : 'header'}
        accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
        onPress={onOpenTitle}
        disabled={!onOpenTitle}
        style={({ pressed }) => [styles.who, pressed && styles.pressed]}>
        <Avatar name={title} kit={kit} size={space.xxl + space.xs} />
        <View style={styles.names}>
          <Text variant="headline" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              variant="caption"
              tone="inkMuted"
              numberOfLines={1}
              onPress={onOpenSubtitle}
              accessibilityRole={onOpenSubtitle ? 'link' : undefined}
              testID="chat-header-team">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {onMore ? <IconButton testID="chat-more" icon="ellipsis" accessibilityLabel="More" onPress={onMore} /> : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
    backgroundColor: colors.surface,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH },
  names: { flex: 1 },
  pressed: { opacity: 0.8 },
}));
