// A venue's extras, shown small wherever the venue comes up (S5A): its
// amenities as icons (optionally with tiny labels) and its food and drink as
// photo cards. Only what the venue has entered; with nothing, nothing.
import { Image } from 'expo-image';
import { Pressable, ScrollView, View } from 'react-native';

import { IconSymbol, Text } from '@/components/ui';
import { ICON } from '@/components/ui/foundation';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';
import type { FoodCard } from '@/lib/venue-extras';
import { AMENITIES, amenitiesByPriority, type AmenityKind } from '@/lib/venue-page';

type Amenity = { kind: AmenityKind; note?: string | null };

function amenityName(a: Amenity): string {
  return a.kind === 'other' && a.note ? a.note : AMENITIES[a.kind].label;
}

export function AmenityIcons({
  amenities,
  max,
  labels = false,
  testID,
}: {
  amenities: Amenity[];
  /** At most this many, food and drink first, then parking. */
  max?: number;
  /** A tiny label (and note) under each icon. */
  labels?: boolean;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const order = amenitiesByPriority(
    amenities.map((a) => a.kind),
    max,
  );
  const shown = order.map((k) => amenities.find((a) => a.kind === k)!);
  if (shown.length === 0) return null;

  if (!labels) {
    return (
      <View testID={testID} style={styles.row} accessible accessibilityLabel={shown.map(amenityName).join(', ')}>
        {shown.map((a) => (
          <IconSymbol key={a.kind} name={AMENITIES[a.kind].icon} size={ICON.small} color={colors.inkMuted} />
        ))}
      </View>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID} contentContainerStyle={styles.labelled}>
      {shown.map((a) => {
        const name = amenityName(a);
        const note = a.kind === 'other' ? null : (a.note ?? null);
        return (
          <View key={a.kind} style={styles.amenity} accessible accessibilityLabel={note ? `${name}, ${note}` : name}>
            <IconSymbol name={AMENITIES[a.kind].icon} size={ICON.regular} color={colors.ink} />
            <Text variant="caption" style={styles.center} numberOfLines={2}>
              {name}
            </Text>
            {note ? (
              <Text variant="caption" tone="inkMuted" style={styles.center} numberOfLines={1}>
                {note}
              </Text>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

export function FoodCards({ cards, onPress, testID }: { cards: FoodCard[]; onPress?: (id: string) => void; testID: string }) {
  const styles = useStyles();
  if (cards.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID} contentContainerStyle={styles.cards}>
      {cards.map((c) => (
        <Pressable
          key={c.id}
          testID={`${testID}-${c.id}`}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : undefined}
          onPress={() => onPress?.(c.id)}
          style={styles.card}>
          {c.photoUrl ? (
            <Image source={{ uri: c.photoUrl }} contentFit="cover" accessibilityLabel={c.name} style={styles.photo} />
          ) : null}
          <View style={styles.body}>
            <Text variant="callout" numberOfLines={2} accessibilityLabel={c.photoUrl ? undefined : c.name}>
              {c.name}
            </Text>
            {c.price ? (
              <View style={styles.prices}>
                <Text variant="headline" tabular>
                  {c.price}
                </Text>
                {c.was ? (
                  <Text variant="caption" tone="inkMuted" tabular style={styles.struck} accessibilityLabel={`was ${c.was}`}>
                    {c.was}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {c.afterGame ? (
              <View style={styles.tag}>
                <Text variant="caption">After game</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** A food card's width: two and a bit fit on a small phone, so the row reads as one to swipe. */
const CARD_WIDTH = space.xxl * 5;

const useStyles = makeStyles(({ colors }) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  labelled: { gap: space.md },
  amenity: { width: space.xxl * 2 + space.md, alignItems: 'center', gap: space.xs },
  center: { textAlign: 'center' },
  cards: { gap: space.md },
  card: {
    width: CARD_WIDTH,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  photo: { width: '100%', aspectRatio: 4 / 3 },
  body: { padding: space.md, gap: space.xs },
  prices: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  struck: { textDecorationLine: 'line-through' },
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs / 2,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
  },
}));
