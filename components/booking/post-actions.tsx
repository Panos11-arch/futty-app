// A Booking v2 post's price and action in "Find a game" (B4; spec 13
// "Publish game"): Join, Accept as opponent, Unpublish (my own post) or View
// booking (a game I joined). Every amount is booking_post_quotes'.
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { cyprusDayTime } from '@/lib/booking-opposition';
import { joinPriceText, postAction, sideBPriceText, type BookingPostQuote } from '@/lib/booking-posts';

export type PostActionsProps = {
  kind: 'players' | 'opposition';
  quote: BookingPostQuote;
  joinedByMe: boolean;
  busy: boolean;
  error: string | null;
  onUnpublish: () => void;
  onJoin: () => void;
  onAccept: () => void;
  onView: () => void;
};

export function PostActions({ kind, quote, joinedByMe, busy, error, onUnpublish, onJoin, onAccept, onView }: PostActionsProps) {
  const action = postAction(kind, quote, joinedByMe);
  const price = kind === 'players' ? joinPriceText(quote) : sideBPriceText(quote);

  return (
    <View style={styles.group}>
      {price ? (
        <Text variant="callout" tabular>
          {price}
        </Text>
      ) : null}
      {kind === 'opposition' && action === 'accept' ? (
        <Text variant="caption" tone="inkMuted" tabular>
          {`Accept by ${cyprusDayTime(quote.closes_at)}`}
        </Text>
      ) : null}
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {action === 'join' ? <Button label="Join" onPress={onJoin} loading={busy} testID="post-join" /> : null}
      {action === 'accept' ? (
        <Button label="Accept as opponent" onPress={onAccept} loading={busy} testID="post-accept-opponent" />
      ) : null}
      {action === 'unpublish' ? (
        <Button label="Unpublish" variant="secondary" onPress={onUnpublish} loading={busy} testID="post-unpublish" />
      ) : null}
      {action === 'view' ? (
        <Button label="View booking" variant="secondary" onPress={onView} testID="post-view-booking" />
      ) : null}
      {action === 'closed' ? (
        <Text variant="callout" tone="inkMuted">
          Closed
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
});
