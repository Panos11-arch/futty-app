// A card's one-line info with a close button (SofaScore's "i" line). Closed
// lines stay closed while the page is open.
import { useState } from 'react';
import { View } from 'react-native';

import { ICON } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

export function InfoLine({ text, testID }: { text: string; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <View testID={testID} style={styles.line}>
      <IconSymbol name="info.circle.fill" size={ICON.small} color={colors.muted} />
      <Text variant="caption" tone="inkMuted" style={styles.text} numberOfLines={2}>
        {text}
      </Text>
      <IconButton icon="xmark" size="small" tone="inkMuted" accessibilityLabel="Hide this line" onPress={() => setOpen(false)} testID={`${testID}-close`} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.md,
    borderRadius: radius.control,
    backgroundColor: colors.fill,
  },
  text: { flex: 1 },
}));
