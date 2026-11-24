// Settings → Accessibility (docs/specs/15-design.md section 0.4), stored on
// this phone and applied app-wide through the theme. Labels only.
import { ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { Slider } from '@/components/ui/slider';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { MAX_TEXT_SCALE, makeStyles, useDisplaySettings, useTheme, type DisplaySettings } from '@/lib/theme';

type Toggle = Exclude<keyof DisplaySettings, 'appearance' | 'textScale'>;

const TOGGLES: { key: Toggle; label: string; testID: string }[] = [
  { key: 'dyslexiaFont', label: 'Dyslexia-friendly font', testID: 'accessibility-dyslexia' },
  { key: 'boldText', label: 'Bold text', testID: 'accessibility-bold' },
  { key: 'highContrast', label: 'High contrast', testID: 'accessibility-contrast' },
  { key: 'reduceMotion', label: 'Reduce motion', testID: 'accessibility-motion' },
  { key: 'colourBlind', label: 'Colour-blind friendly', testID: 'accessibility-colour-blind' },
  { key: 'haptics', label: 'Haptics', testID: 'accessibility-haptics' },
];

const percent = (scale: number) => `${Math.round(scale * 100)}%`;

export default function AccessibilityScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { settings, updateSettings } = useDisplaySettings();

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <SectionHeader title="Text size" />
          <Card>
            <View style={styles.sizeRow}>
              <View style={styles.slider}>
                <Slider
                  testID="accessibility-text-size"
                  accessibilityLabel="Text size"
                  value={settings.textScale}
                  min={1}
                  max={MAX_TEXT_SCALE}
                  step={0.1}
                  formatValue={percent}
                  onChange={(textScale) => updateSettings({ textScale })}
                />
              </View>
              <Text variant="headline" tabular testID="accessibility-text-size-value">
                {percent(settings.textScale)}
              </Text>
            </View>
          </Card>
        </View>

        <Card padded={false}>
          {TOGGLES.map(({ key, label, testID }) => (
            <ListRow
              key={key}
              testID={testID}
              title={label}
              trailing={
                <Switch
                  testID={`${testID}-switch`}
                  accessibilityLabel={label}
                  value={settings[key]}
                  trackColor={{ true: colors.green, false: colors.border }}
                  onValueChange={(value) => {
                    updateSettings({ [key]: value });
                    // Turning haptics on gives one, so the player feels it work.
                    if (key === 'haptics' && value) haptic.tap();
                  }}
                />
              }
            />
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  flex: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  section: { gap: space.sm },
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  slider: { flex: 1 },
}));
