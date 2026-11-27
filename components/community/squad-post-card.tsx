// S7 (image 18): a squad post in the feed: who posted, what they need, Join
// squad, and Message only when the server says a chat is allowed (friends,
// same age group, not blocked: S20).
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ActorRow } from '@/components/community/actor-row';
import { Pill } from '@/components/community/pill';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import type { SquadPostItem } from '@/lib/community';
import { ownPostHref, postLine, postSubtitle, spotsLabel } from '@/lib/community-feed';
import { cardHref } from '@/lib/find-match';
import { haptic } from '@/lib/haptics';
import { chatHref, describeMessageError, openFriendConversation } from '@/lib/messages';
import { makeStyles } from '@/lib/theme';

export function SquadPostCard({ item, now }: { item: SquadPostItem; now?: Date }) {
  const styles = useStyles();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spots = spotsLabel(item.spots);
  const open = item.post_status === 'open';
  // My own post opens its game; someone else's opens Join or Accept.
  const href = item.mine
    ? ownPostHref(item)
    : open
      ? cardHref({ post_id: item.item_id, kind: item.post_type, v2: item.v2, mine: false, booking_id: null })
      : null;

  function join() {
    if (!href) return;
    haptic.tap();
    router.push(href);
  }

  async function message() {
    if (!item.actor_id || opening) return;
    setOpening(true);
    setError(null);
    const { conversationId, error: openError } = await openFriendConversation(item.actor_id);
    setOpening(false);
    if (openError || !conversationId) {
      setError(describeMessageError(openError));
      return;
    }
    router.push(chatHref(conversationId));
  }

  return (
    <Card testID={`feed-post-${item.item_id}`} style={styles.card}>
      <ActorRow
        item={item}
        subtitle={postSubtitle(item, now)}
        pill={spots ? <Pill label={spots} testID={`feed-post-spots-${item.item_id}`} /> : null}
      />
      <Text variant="body">{postLine(item, now)}</Text>
      {href ? (
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button
              testID={`feed-post-join-${item.item_id}`}
              label={item.mine ? 'Open post' : item.post_type === 'opposition' ? 'Accept as opponent' : 'Join squad'}
              variant={item.mine ? 'secondary' : 'primary'}
              fullWidth
              onPress={join}
            />
          </View>
          {item.can_message && !item.mine ? (
            <View style={styles.flex}>
              <Button
                testID={`feed-post-message-${item.item_id}`}
                label="Message"
                variant="secondary"
                fullWidth
                loading={opening}
                onPress={message}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.md },
  actions: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
}));
