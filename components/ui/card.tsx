import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, space } from '@/constants/futty-theme';

export type CardProps = {
  children: ReactNode;
  onPress?: () => void;
  /** Needed when pressable: what the card opens. */
  accessibilityLabel?: string;
  /** Edge-to-edge content (a photo on top) handles its own padding. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Surface with the one soft shadow (never a border as well). */
export function Card({ children, onPress, accessibilityLabel, padded = true, style, testID }: CardProps) {
  const cardStyle = [styles.card, padded && styles.padded, style];
  if (!onPress) {
    return (
      <View testID={testID} style={cardStyle}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [cardStyle, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.card, ...shadow },
  padded: { padding: space.lg },
  pressed: { opacity: 0.9 },
});
