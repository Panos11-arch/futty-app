import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

export type CardProps = {
  children: ReactNode;
  onPress?: () => void;
  /** Needed when pressable: what the card opens. */
  accessibilityLabel?: string;
  /** Edge-to-edge content (a photo on top) handles its own padding. */
  padded?: boolean;
  /** A chosen option: a green border. */
  selected?: boolean;
  /** night: a dark panel (featured event, league header). */
  tone?: 'surface' | 'night';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** A surface with a hairline border, no shadow (the agreed screens). */
export function Card({
  children,
  onPress,
  accessibilityLabel,
  padded = true,
  selected = false,
  tone = 'surface',
  style,
  testID,
}: CardProps) {
  const styles = useStyles();
  const cardStyle = [
    styles.card,
    tone === 'night' && styles.night,
    selected && styles.selected,
    padded && styles.padded,
    style,
  ];
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
      accessibilityState={selected ? { selected } : undefined}
      onPress={onPress}
      style={({ pressed }) => [cardStyle, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, hairline }) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: hairline * 2,
    borderColor: colors.border,
  },
  night: { backgroundColor: colors.night, borderColor: colors.night },
  selected: { borderColor: colors.green, borderWidth: 2, backgroundColor: colors.greenSoft },
  padded: { padding: space.lg },
  pressed: { opacity: 0.9 },
}));
