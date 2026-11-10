import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { initials } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { colors, radius, space } from '@/constants/futty-theme';
import { formatEuros } from '@/lib/money/format';

export type VenueCardProps = {
  name: string;
  area: string;
  /** From the server, in integer cents. Only formatted here. */
  pricePerPlayerCents: number;
  photoUrl?: string | null;
  /** Next free kickoff times as the server returns them, e.g. "18:00". */
  nextTimes: string[];
  onPress: () => void;
  onTimePress?: (time: string) => void;
  testID?: string;
};

export function VenueCard({
  name,
  area,
  pricePerPlayerCents,
  photoUrl,
  nextTimes,
  onPress,
  onTimePress,
  testID,
}: VenueCardProps) {
  const price = `${formatEuros(pricePerPlayerCents)} per player`;
  return (
    <Card testID={testID} padded={false} onPress={onPress} accessibilityLabel={`${name}, ${area}, ${price}`}>
      {photoUrl ? (
        <Image
          testID="venue-card-photo"
          source={{ uri: photoUrl }}
          contentFit="cover"
          accessibilityLabel={`Photo of ${name}`}
          style={styles.photo}
        />
      ) : (
        <View testID="venue-card-placeholder" style={[styles.photo, styles.placeholder]}>
          <Text variant="display" tone="inkMuted">
            {initials(name)}
          </Text>
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text variant="headline">{name}</Text>
            <Text variant="callout" tone="inkMuted">
              {area}
            </Text>
          </View>
          <Text variant="callout" tabular>
            {price}
          </Text>
        </View>
        {nextTimes.length > 0 ? (
          <View style={styles.times}>
            {nextTimes.map((time) => (
              <Chip key={time} label={time} tabular onPress={() => (onTimePress ?? onPress)(time)} />
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  placeholder: { backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.lg, gap: space.md },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  titleText: { flex: 1, gap: 2 },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
