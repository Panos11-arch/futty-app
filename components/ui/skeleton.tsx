import { View, type DimensionValue } from 'react-native';

import { radius, space, type TypeVariant } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

// Skeletons are still blocks in the shape of the content: no shimmer, so
// nothing moves on screen while loading (motion only explains change).

export type SkeletonBlockProps = {
  width: DimensionValue;
  height: DimensionValue;
  rounded?: keyof typeof radius;
};

export function SkeletonBlock({ width, height, rounded = 'card' }: SkeletonBlockProps) {
  const styles = useStyles();
  return (
    <View
      testID="skeleton-block"
      accessible
      accessibilityLabel="Loading"
      style={[styles.fill, { width, height, borderRadius: radius[rounded] }]}
    />
  );
}

export function SkeletonText({ lines = 2, variant = 'body' }: { lines?: number; variant?: TypeVariant }) {
  const styles = useStyles();
  const { lineHeight } = useTheme().type[variant];
  return (
    <View accessible accessibilityLabel="Loading" style={styles.lines}>
      {Array.from({ length: lines }, (_, i) => (
        <View
          key={i}
          testID="skeleton-line"
          style={[
            styles.fill,
            styles.line,
            { height: lineHeight * 0.6, width: i === lines - 1 && lines > 1 ? '60%' : '100%' },
          ]}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  fill: { backgroundColor: colors.fill },
  lines: { gap: space.sm },
  line: { borderRadius: radius.pill },
}));
