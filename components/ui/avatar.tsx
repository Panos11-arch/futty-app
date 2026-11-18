import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text, type TextVariant } from '@/components/ui/text';
import { colors, kitColours, radius } from '@/constants/futty-theme';
import type { AvatarKit } from '@/lib/avatar';

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
  /** A12: the player's Futty kit (lib/avatar.ts avatarKit). Null or missing shows initials. */
  kit?: AvatarKit | null;
  size?: number;
  /** Ring in surface colour, used where avatars overlap. */
  ringed?: boolean;
};

/** A football shirt with sleeves and a V collar, in a 100 x 100 box. */
const SHIRT_PATH = 'M34 10 L44 7 Q50 17 56 7 L66 10 L92 27 L82 45 L72 39 L72 92 L28 92 L28 39 L18 45 L8 27 Z';

/** The shirt number's type style: the largest on the scale that fits the avatar. */
function numberVariant(size: number): TextVariant {
  if (size >= 88) return 'display';
  if (size >= 56) return 'title';
  if (size >= 40) return 'callout';
  return 'caption';
}

function KitShirt({ kit, size }: { kit: AvatarKit; size: number }) {
  const { shirt, label } = kitColours[kit.colour];
  // A white shirt needs an outline to show on the canvas background.
  const outlined = kit.colour === 'kitWhite';
  return (
    <View testID="avatar-kit" style={StyleSheet.absoluteFill}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Path
          testID="avatar-kit-shirt"
          d={SHIRT_PATH}
          fill={shirt}
          stroke={outlined ? colors.border : undefined}
          strokeWidth={outlined ? 3 : undefined}
          strokeLinejoin="round"
        />
      </Svg>
      <View style={styles.number}>
        <Text variant={numberVariant(size)} tabular allowFontScaling={false} style={{ color: label }}>
          {String(kit.number)}
        </Text>
      </View>
    </View>
  );
}

export function Avatar({ name, photoUrl, kit, size = 40, ringed = false }: AvatarProps) {
  const box = [styles.circle, { width: size, height: size }, ringed && styles.ring];
  const label = kit ? `${name}, shirt ${kit.number}` : name;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={box}>
      {photoUrl ? (
        <Image testID="avatar-photo" source={{ uri: photoUrl }} contentFit="cover" style={StyleSheet.absoluteFill} />
      ) : kit ? (
        <KitShirt kit={kit} size={size} />
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
  // The number sits on the shirt's chest, a little below the centre.
  number: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingTop: '18%' },
});
