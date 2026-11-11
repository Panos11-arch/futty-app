import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Text, type TextTone } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';

export type BannerTone = 'info' | 'warning' | 'danger';

export type BannerProps = {
  tone: BannerTone;
  message: string;
  title?: string;
  action?: { label: string; onPress: () => void };
};

const tones: Record<BannerTone, { icon: IconSymbolName; tone: TextTone }> = {
  info: { icon: 'info.circle.fill', tone: 'ink' },
  warning: { icon: 'exclamationmark.triangle.fill', tone: 'warning' },
  danger: { icon: 'exclamationmark.circle.fill', tone: 'danger' },
};

/** Tone shows in the icon and title only; the banner itself is a surface, never a coloured fill. */
export function Banner({ tone, message, title, action }: BannerProps) {
  const look = tones[tone];
  return (
    <View
      testID="banner"
      accessibilityRole={tone === 'info' ? undefined : 'alert'}
      accessibilityLiveRegion="polite"
      style={styles.banner}>
      <View style={styles.row}>
        <IconSymbol name={look.icon} size={ICON.small} color={colors[look.tone === 'ink' ? 'inkMuted' : look.tone]} />
        <View style={styles.text}>
          {title ? (
            <Text variant="headline" tone={look.tone}>
              {title}
            </Text>
          ) : null}
          <Text variant="body">{message}</Text>
        </View>
      </View>
      {action ? (
        <View style={styles.action}>
          <Button label={action.label} variant="secondary" onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  text: { flex: 1, gap: space.xs },
  action: { paddingLeft: space.xl + space.sm },
});
