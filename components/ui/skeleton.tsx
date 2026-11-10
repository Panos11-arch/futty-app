import { StyleSheet, View, type DimensionValue } from 'react-native';

import { colors, radius, space, type } from '@/constants/futty-theme';

// Skeletons are still blocks in the shape of the content: no shimmer, so
// nothing moves on screen while loading (motion only explains change).

export type SkeletonBlockProps = {
  width: DimensionValue;
  height: DimensionValue;
  rounded?: keyof typeof radius;
};

export function SkeletonBlock({ width, height, rounded = 'card' }: SkeletonBlockProps) {
  return (
    <View
      testID="skeleton-block"
      accessible
      accessibilityLabel="Loading"
      style={[styles.fill, { width, height, borderRadius: radius[rounded] }]}
    />
  );
}

export function SkeletonText({ lines = 2, variant = 'body' }: { lines?: number; variant?: keyof typeof type }) {
  const { lineHeight } = type[variant];
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

const styles = StyleSheet.create({
  fill: { backgroundColor: colors.border },
  lines: { gap: space.sm },
  line: { borderRadius: radius.pill },
});
