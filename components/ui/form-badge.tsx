// A W / D / L result badge (docs/specs/15-design.md sections 0.2 and 0.4).
// The letter is always shown, so a result never relies on colour alone. With
// Settings → Accessibility → Colour-blind friendly on, each result also has
// its own shape: W a circle, D a square, L a diamond.
import { View } from 'react-native';

import { Text, type TextTone } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

export type FormBadgeResult = 'W' | 'D' | 'L' | 'L_forfeit';
export type FormBadgeShape = 'circle' | 'square' | 'diamond' | 'pill';

const looks: Record<FormBadgeResult, { tone: TextTone; shape: FormBadgeShape }> = {
  W: { tone: 'greenInk', shape: 'circle' },
  D: { tone: 'ink', shape: 'square' },
  L: { tone: 'onNight', shape: 'diamond' },
  L_forfeit: { tone: 'onNight', shape: 'pill' },
};

/** The shape a result is drawn in; every result is a circle unless Colour-blind friendly is on. */
export function formBadgeShape(result: FormBadgeResult, colourBlind: boolean): FormBadgeShape {
  if (result === 'L_forfeit') return 'pill';
  return colourBlind ? looks[result].shape : 'circle';
}

export type FormBadgeProps = {
  result: FormBadgeResult;
  /** What it reads: "W", or "L (forfeit)". */
  label: string;
  /** What a screen reader says: "won". */
  accessibilityLabel: string;
  testID?: string;
};

export function FormBadge({ result, label, accessibilityLabel, testID }: FormBadgeProps) {
  const styles = useStyles();
  const { colourBlind } = useTheme();
  const shape = formBadgeShape(result, colourBlind);
  const fill = result === 'W' ? styles.win : result === 'D' ? styles.draw : styles.loss;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel}
      style={[styles.badge, styles[shape], fill]}>
      <View style={shape === 'diamond' ? styles.unrotate : undefined}>
        <Text
          variant="caption"
          tone={result === 'D' ? 'ink' : looks[result].tone}
          style={result === 'D' ? styles.drawText : result === 'W' ? styles.winText : styles.lossText}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const SIZE = space.lg + space.sm;

const useStyles = makeStyles(({ colors }) => ({
  badge: { minWidth: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  circle: { width: SIZE, borderRadius: radius.pill },
  square: { width: SIZE, borderRadius: space.xs },
  diamond: { width: SIZE - space.xs, height: SIZE - space.xs, borderRadius: space.xs, transform: [{ rotate: '45deg' }] },
  pill: { paddingHorizontal: space.sm, borderRadius: radius.pill },
  unrotate: { transform: [{ rotate: '-45deg' }] },
  win: { backgroundColor: colors.formWin },
  draw: { backgroundColor: colors.formDraw },
  loss: { backgroundColor: colors.formLoss },
  winText: { color: colors.onFormWin },
  drawText: { color: colors.onFormDraw },
  lossText: { color: colors.onFormLoss },
}));
