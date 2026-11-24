// A row with a tick: one choice of several (radio) or on/off (checkbox),
// for the Book a pitch sheets.
import { View } from 'react-native';

import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ListRow } from '@/components/ui';
import { useTheme } from '@/lib/theme';

export function ChoiceRow({
  title,
  subtitle,
  checked,
  kind,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string;
  checked: boolean;
  kind: 'radio' | 'checkbox';
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <ListRow
      testID={testID}
      title={title}
      subtitle={subtitle}
      accessibilityRole={kind}
      accessibilityState={{ checked }}
      onPress={onPress}
      trailing={
        <View>
          <IconSymbol
            name={checked ? 'checkmark.circle.fill' : 'circle'}
            size={ICON.regular}
            color={checked ? colors.ink : colors.inkMuted}
          />
        </View>
      }
    />
  );
}
