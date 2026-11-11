import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';

export type EmptyStateProps = {
  icon: IconSymbolName;
  /** One line, sentence case. */
  message: string;
  action?: { label: string; onPress: () => void };
};

export function EmptyState({ icon, message, action }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View testID="empty-state-icon">
        <IconSymbol name={icon} size={ICON.regular} color={colors.inkMuted} />
      </View>
      <Text variant="body" tone="inkMuted" style={styles.message}>
        {message}
      </Text>
      {action ? <Button label={action.label} variant="secondary" onPress={action.onPress} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.md, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  message: { textAlign: 'center' },
});
