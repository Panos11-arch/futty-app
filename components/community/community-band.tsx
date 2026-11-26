// S7 (image 18): the dark band under the tab header: Search, Messages (S13's
// inbox, with the unread count) and the tabs For you | Following | Find players.
import { Pressable, View } from 'react-native';

import { UnreadBadge, unreadLabel } from '@/components/messages/unread-badge';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

export type CommunityTab = 'for_you' | 'following' | 'find_players';

export const COMMUNITY_TABS: { value: CommunityTab; label: string; testID: string }[] = [
  { value: 'for_you', label: 'For you', testID: 'community-tab-for-you' },
  { value: 'following', label: 'Following', testID: 'community-tab-following' },
  { value: 'find_players', label: 'Find players', testID: 'community-tab-find-players' },
];

export function CommunityBand({
  tab,
  onTab,
  onSearch,
  onMessages,
  unread,
}: {
  tab: CommunityTab;
  onTab: (tab: CommunityTab) => void;
  onSearch: () => void;
  onMessages: () => void;
  unread: number;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const unreadText = unreadLabel(unread);

  return (
    <View testID="community-band" style={styles.band}>
      <View style={styles.top}>
        <Pressable
          testID="community-search"
          accessibilityRole="search"
          accessibilityLabel="Search players and teams"
          onPress={onSearch}
          style={({ pressed }) => [styles.search, pressed && styles.pressed]}>
          <IconSymbol name="magnifyingglass" size={ICON.small} color={colors.onNightMuted} />
          <Text variant="callout" tone="onNightMuted">
            Search
          </Text>
        </Pressable>
        <Pressable
          testID="community-messages"
          accessibilityRole="button"
          accessibilityLabel={unreadText ? `Messages, ${unreadText}` : 'Messages'}
          onPress={onMessages}
          style={({ pressed }) => [styles.messages, pressed && styles.pressed]}>
          <IconSymbol name="bubble.left.fill" size={ICON.regular} color={colors.onNight} />
          <View style={styles.badge} pointerEvents="none">
            <UnreadBadge count={unread} testID="community-messages-badge" />
          </View>
        </Pressable>
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {COMMUNITY_TABS.map((t) => {
          const selected = t.value === tab;
          return (
            <Pressable
              key={t.value}
              testID={t.testID}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={t.label}
              onPress={() => onTab(t.value)}
              style={styles.tab}>
              <Text variant="headline" tone={selected ? 'onNight' : 'onNightMuted'} numberOfLines={1}>
                {t.label}
              </Text>
              <View style={[styles.underline, selected && styles.underlineOn]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  band: { backgroundColor: colors.night, paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.onNightMuted,
  },
  messages: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 0, right: 0 },
  pressed: { opacity: 0.8 },
  tabs: { flexDirection: 'row', gap: space.xl },
  tab: { minHeight: MIN_TOUCH, justifyContent: 'flex-end', gap: space.sm, flexShrink: 1 },
  underline: { height: space.xs, borderRadius: radius.pill, backgroundColor: colors.green, opacity: 0 },
  underlineOn: { opacity: 1 },
}));
