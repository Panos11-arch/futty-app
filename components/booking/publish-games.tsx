// "Your games" at the top of "Find a game" (B4; spec 13 "Publish game"): the
// games the player captains, to publish (open spots, or on a half pitch a
// public opposition post) or unpublish. The server decides what can be
// published (my_publishable_bookings, publish_booking).
import { StyleSheet, View } from 'react-native';

import { Button, Card, SectionHeader, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { publishGameRow, type PublishableBooking } from '@/lib/booking-posts';

export type PublishGamesProps = {
  kind: 'players' | 'opposition';
  games: PublishableBooking[];
  /** The booking being published or unpublished. */
  busyId: string | null;
  error: string | null;
  onPublish: (bookingId: string) => void;
  onUnpublish: (postId: string) => void;
};

const EXPLAIN = {
  players: 'Anyone can join your open spots and pays as your side pays. The slot stays booked.',
  opposition: 'Any team can take your game on. The slot stays booked.',
};

export function PublishGames({ kind, games, busyId, error, onPublish, onUnpublish }: PublishGamesProps) {
  const rows = games
    .map((game) => ({ game, row: publishGameRow(game, kind) }))
    .filter((r): r is { game: PublishableBooking; row: NonNullable<ReturnType<typeof publishGameRow>> } => r.row !== null);
  if (rows.length === 0) return null;

  return (
    <View style={styles.group}>
      <SectionHeader title="Your games" />
      <Text variant="callout" tone="inkMuted">
        {EXPLAIN[kind]}
      </Text>
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {rows.map(({ game, row }) => (
        <Card key={game.booking_id} testID={`publish-game-${game.booking_id}`} style={styles.card}>
          <View style={styles.text}>
            <Text variant="headline">{row.title}</Text>
            <Text variant="callout" tone="inkMuted" tabular>
              {row.subtitle}
            </Text>
          </View>
          <Button
            label={row.action === 'publish' ? 'Publish' : 'Unpublish'}
            variant={row.action === 'publish' ? 'primary' : 'secondary'}
            loading={busyId === game.booking_id}
            disabled={busyId !== null && busyId !== game.booking_id}
            onPress={() => (row.postId ? onUnpublish(row.postId) : onPublish(game.booking_id))}
            testID={`publish-game-button-${game.booking_id}`}
          />
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  card: { gap: space.md },
  text: { gap: space.xs },
});
