// A Find a match game (image 05): "19:00 · 7-a-side", the level (or the
// "Opposition wanted" tag), the organiser and venue, avatar circles with
// "12/14", and the server's price per player. The card opens the join or
// accept screen; the organiser and each avatar open their own profile.
import { Pressable, View } from 'react-native';

import { Avatar, Card, Text } from '@/components/ui';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { radius, space } from '@/constants/futty-theme';
import { levelText, organiserOf, priceText, spotsText, type MatchCard as MatchCardData } from '@/lib/find-match';
import { makeStyles } from '@/lib/theme';

/** At most this many circles; the server sends no more. */
const MAX_AVATARS = 5;
const AVATAR_SIZE = 32;

export type MatchCardProps = {
  card: MatchCardData;
  onOpen: () => void;
  onOpenPlayer: (profileId: string) => void;
  onOpenTeam: (teamId: string) => void;
};

export function MatchCard({ card, onOpen, onOpenPlayer, onOpenTeam }: MatchCardProps) {
  const styles = useStyles();
  const id = card.post_id;
  const opposition = card.kind === 'opposition';
  const level = levelText(card.level_min, card.level_max);
  const spots = spotsText(card);
  const price = priceText(card.priceCents);
  const organiser = organiserOf(card);
  const organiserLabel = opposition ? organiser.name : `Organised by ${organiser.name}`;
  const openOrganiser =
    organiser.kind === 'team'
      ? () => onOpenTeam(organiser.id)
      : organiser.id
        ? () => onOpenPlayer(organiser.id as string)
        : undefined;
  const people = card.people.slice(0, MAX_AVATARS);

  const summary = [
    `${card.time}, ${card.format}`,
    opposition ? 'Opposition wanted' : null,
    organiserLabel,
    level,
    card.venue_name,
    spots ? `${card.players_in} of ${card.capacity} players` : null,
    price,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card testID={`find-match-card-${id}`} onPress={onOpen} accessibilityLabel={summary} style={styles.card}>
      <View style={styles.row}>
        <Text variant="headline" tabular style={styles.grow}>
          {`${card.time} · ${card.format}`}
        </Text>
        {opposition ? (
          <View testID={`find-match-opposition-${id}`} style={styles.tag}>
            <Text variant="caption" tone="warning">
              Opposition wanted
            </Text>
          </View>
        ) : level ? (
          <Text variant="callout" tone="inkMuted" tabular>
            {level}
          </Text>
        ) : null}
      </View>

      <View style={styles.line}>
        {openOrganiser ? (
          <Pressable
            testID={`find-match-organiser-${id}`}
            accessibilityRole="link"
            accessibilityLabel={`Open ${organiser.name}`}
            onPress={openOrganiser}
            hitSlop={space.sm}>
            <Text variant="callout" tone="inkMuted">
              {organiserLabel}
            </Text>
          </Pressable>
        ) : (
          <Text variant="callout" tone="inkMuted">
            {organiserLabel}
          </Text>
        )}
        <Text variant="callout" tone="inkMuted" style={styles.grow} numberOfLines={2}>
          {[opposition ? level : null, card.venue_name].filter(Boolean).map((part) => ` · ${part}`).join('')}
        </Text>
      </View>

      <View style={styles.row}>
        <View style={[styles.row, styles.grow]}>
          <View style={styles.avatars}>
            {people.map((person, i) => {
              const avatar = <Avatar name={person.name} size={AVATAR_SIZE} ringed />;
              const style = i > 0 ? styles.overlap : undefined;
              return person.id ? (
                <Pressable
                  key={person.id}
                  testID={`find-match-avatar-${id}-${i}`}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${person.name}`}
                  onPress={() => onOpenPlayer(person.id as string)}
                  style={[styles.avatarHit, style]}>
                  {avatar}
                </Pressable>
              ) : (
                <View key={`guest-${i}`} style={[styles.avatarHit, style]} accessibilityLabel={person.name}>
                  {avatar}
                </View>
              );
            })}
          </View>
          {spots ? (
            <Text variant="callout" tone="inkMuted" tabular>
              {spots}
            </Text>
          ) : null}
        </View>
        {price ? (
          <Text testID={`find-match-price-${id}`} variant="headline" tabular>
            {price}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  card: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  grow: { flexShrink: 1, flexGrow: 1 },
  tag: {
    backgroundColor: colors.warningLight,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatarHit: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  overlap: { marginLeft: -space.sm },
}));
