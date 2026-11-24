import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Text, useToneColour, type TextTone } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

export type BannerTone = 'info' | 'warning' | 'danger';

export type BannerProps = {
  tone: BannerTone;
  message: string;
  title?: string;
  action?: { label: string; onPress: () => void };
};

const tones: Record<BannerTone, { icon: IconSymbolName; tone: TextTone }> = {
  info: { icon: 'info.circle.fill', tone: 'info' },
  warning: { icon: 'exclamationmark.triangle.fill', tone: 'warning' },
  danger: { icon: 'exclamationmark.circle.fill', tone: 'danger' },
};

/** A tinted panel with a border in its tone (the agreed screens); the message stays in ink. */
export function Banner({ tone, message, title, action }: BannerProps) {
  const styles = useStyles();
  const look = tones[tone];
  const iconColour = useToneColour(look.tone);
  return (
    <View
      testID="banner"
      accessibilityRole={tone === 'info' ? undefined : 'alert'}
      accessibilityLiveRegion="polite"
      style={[styles.banner, styles[tone]]}>
      <View style={styles.row}>
        <IconSymbol name={look.icon} size={ICON.small} color={iconColour} />
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

const useStyles = makeStyles(({ colors, hairline }) => ({
  banner: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: hairline * 2,
  },
  info: { backgroundColor: colors.infoLight, borderColor: colors.info },
  warning: { backgroundColor: colors.warningLight, borderColor: colors.warning },
  danger: { backgroundColor: colors.dangerLight, borderColor: colors.danger },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  text: { flex: 1, gap: space.xs },
  action: { paddingLeft: space.xl + space.sm },
}));
