// Settings → Appearance (docs/specs/15-design.md section 0.2): System,
// Light or Dark, stored on this phone. The whole app switches at once.
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ListRow } from '@/components/ui/list-row';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { makeStyles, useDisplaySettings, useTheme, type Appearance } from '@/lib/theme';

const APPEARANCE_OPTIONS: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function AppearanceScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { settings, updateSettings } = useDisplaySettings();

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card padded={false}>
          <View accessibilityRole="radiogroup" accessibilityLabel="Appearance">
            {APPEARANCE_OPTIONS.map(({ value, label }) => {
              const selected = settings.appearance === value;
              return (
                <ListRow
                  key={value}
                  testID={`appearance-${value}`}
                  title={label}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  trailing={
                    selected ? <IconSymbol name="checkmark" size={ICON.small} color={colors.positive} /> : null
                  }
                  onPress={() => {
                    if (selected) return;
                    haptic.tap();
                    updateSettings({ appearance: value });
                  }}
                />
              );
            })}
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  flex: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.xl, padding: space.lg },
}));
