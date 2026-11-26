import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

/** A competition's badge: night with green letters in lists, green with
 *  dark letters on a night header (green text only ever sits on night). */
export function CompetitionBadge({ label, tone = 'night', size = 'regular' }: { label: string; tone?: 'night' | 'green'; size?: 'regular' | 'large' }) {
  const styles = useStyles();
  return (
    <View
      style={[styles.badge, size === 'large' && styles.badgeLarge, tone === 'green' ? styles.badgeGreen : styles.badgeNight]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden>
      <Text variant={size === 'large' ? 'title' : 'callout'} style={[styles.badgeText, tone === 'green' ? styles.onGreen : styles.onNightGreen]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export type NightTab<T extends string> = { value: T; label: string; testID: string };

export type NightHeaderProps<T extends string> = {
  title: string;
  subtitle?: string;
  badge?: string;
  /** "‹ Leagues" above the title. */
  back?: { label: string; onPress: () => void; testID?: string };
  tabs?: { options: NightTab<T>[]; value: T; onChange: (value: T) => void };
};

/** The dark header of the Leagues screen and competition pages (images 12,
 *  16, 17): back link, badge, title and subtitle, and underlined tabs. */
export function NightHeader<T extends string>({ title, subtitle, badge, back, tabs }: NightHeaderProps<T>) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space.sm }]}>
      {back ? (
        <Pressable
          testID={back.testID}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${back.label}`}
          onPress={back.onPress}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <IconSymbol name="chevron.left" size={ICON.small} color={colors.onNight} />
          <Text variant="body" tone="onNight">
            {back.label}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.titleRow}>
        {badge ? <CompetitionBadge label={badge} tone="green" size="large" /> : null}
        <View style={styles.titles} accessible accessibilityRole="header">
          <Text variant="display" tone="onNight" numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="callout" tone="onNightMuted" numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {tabs ? (
        <View style={styles.tabs} accessibilityRole="tablist">
          {tabs.options.map((tab) => {
            const selected = tab.value === tabs.value;
            return (
              <Pressable
                key={tab.value}
                testID={tab.testID}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected }}
                onPress={() => tabs.onChange(tab.value)}
                style={[styles.tab, selected && styles.tabSelected]}>
                <Text variant="headline" tone={selected ? 'onNight' : 'onNightMuted'}>
                  {tab.label.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors, type }) => ({
  bar: {
    backgroundColor: colors.night,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    gap: space.md,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH, alignSelf: 'flex-start' },
  pressed: { opacity: 0.7 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  titles: { flex: 1, gap: space.xs },
  tabs: { flexDirection: 'row', gap: space.xl, marginBottom: -space.lg },
  tab: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    borderBottomWidth: space.xs - 1,
    borderBottomColor: colors.night,
  },
  tabSelected: { borderBottomColor: colors.green },
  badge: { minWidth: MIN_TOUCH, height: MIN_TOUCH, paddingHorizontal: space.xs, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  badgeLarge: { minWidth: space.xxl * 3, height: space.xxl * 3, borderRadius: radius.card },
  badgeNight: { backgroundColor: colors.night, borderWidth: hairline, borderColor: colors.night },
  badgeGreen: { backgroundColor: colors.green },
  badgeText: { fontFamily: type.title.fontFamily },
  onNightGreen: { color: colors.green },
  onGreen: { color: colors.greenInk },
}));
