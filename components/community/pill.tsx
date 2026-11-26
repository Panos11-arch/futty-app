import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

/** A small label on a card ("2 spots", "League"): green tint, dark green text. */
export function Pill({ label, testID }: { label: string; testID?: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={styles.pill}>
      <Text variant="caption" tone="success" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  pill: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
  },
}));
