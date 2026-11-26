import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { avatarLook } from '@/lib/avatar';
import type { FeedItem } from '@/lib/community';
import { profileHref, teamHref } from '@/lib/messages';
import { makeStyles } from '@/lib/theme';

/** Who a card is about: avatar, name and a line under it. Opens their
 *  profile or team page; a pill can sit on the right. */
export function ActorRow({ item, subtitle, pill }: { item: FeedItem; subtitle: string; pill?: ReactNode }) {
  const styles = useStyles();
  const href = item.actor_id ? (item.actor_kind === 'team' ? teamHref(item.actor_id) : profileHref(item.actor_id)) : null;
  const look = item.actor_kind === 'player' ? avatarLook(item) : null;

  const main = (
    <>
      <Avatar name={item.actor_name} kit={look} size={MIN_TOUCH + space.xs} />
      <View style={styles.text}>
        <Text variant="headline" numberOfLines={1}>
          {item.actor_name}
        </Text>
        <Text variant="callout" tone="inkMuted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </>
  );

  return (
    <View style={styles.row}>
      {href ? (
        <Pressable
          testID={`feed-actor-${item.item_id}`}
          accessibilityRole="button"
          accessibilityLabel={`${item.actor_name}, ${subtitle}`}
          onPress={() => router.push(href)}
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
          {main}
        </Pressable>
      ) : (
        <View style={styles.main}>{main}</View>
      )}
      {pill}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH },
  text: { flex: 1 },
  pressed: { opacity: 0.8 },
}));
