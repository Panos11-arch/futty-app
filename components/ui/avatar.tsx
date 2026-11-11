import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { colors, radius } from '@/constants/futty-theme';

/** "Andreas Georgiou" -> "AG"; first letters of the first two words. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

export type AvatarProps = {
  name: string;
  photoUrl?: string | null;
  size?: number;
  /** Ring in surface colour, used where avatars overlap. */
  ringed?: boolean;
};

export function Avatar({ name, photoUrl, size = 40, ringed = false }: AvatarProps) {
  const box = [
    styles.circle,
    { width: size, height: size },
    ringed && styles.ring,
  ];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={name} style={box}>
      {photoUrl ? (
        <Image testID="avatar-photo" source={{ uri: photoUrl }} contentFit="cover" style={StyleSheet.absoluteFill} />
      ) : (
        <Text variant="caption" tone="inkMuted" allowFontScaling={false}>
          {initials(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: radius.pill,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ring: { borderWidth: 2, borderColor: colors.surface },
});
