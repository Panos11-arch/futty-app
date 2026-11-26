// S8 Profile tab, the dark top (image 19; spec 15 "Dark top with level, My
// card and Edit profile"): Share and Settings, the avatar (opens Edit
// avatar), name, "@handle · Area · Position · Foot", followers and
// following, the level bar, then My card and Edit profile. Every number
// comes from the server.
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { avatarLook } from '@/lib/avatar';
import { formatLevel, startingLevelOffered, type PlayerLevel } from '@/lib/match/levels';
import {
  followLine,
  levelProgress,
  levelRightLabel,
  profileSubtitle,
  type ProfileSummary,
} from '@/lib/match/profile-summary-api';
import type { Loadable } from '@/lib/match/use-match-result';
import { STARTING_LEVEL_ROUTE } from '@/lib/match/use-levels';
import { makeStyles } from '@/lib/theme';
import type { Profile } from '@/lib/use-profile';

/** 72 points, as image 19's avatar. */
const AVATAR_SIZE = space.xxl * 2 + space.sm;

export type ProfileTopProps = {
  profile: Profile;
  summary: Loadable<{ summary: ProfileSummary }>;
  level: Loadable<{ level: PlayerLevel | null }>;
  /** Off for a minor or a player without a username (my_player_card's show_qr). */
  canShare: boolean;
  topInset: number;
  onShare: () => void;
  onMyCard: () => void;
};

function TopLink({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const styles = useStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={space.sm}
      style={({ pressed }) => [styles.topLink, pressed && styles.pressed]}>
      <Text variant="callout" tone="onNightMuted">
        {label}
      </Text>
    </Pressable>
  );
}

function LevelRow({ level, change }: { level: Loadable<{ level: PlayerLevel | null }>; change: number | null }) {
  const styles = useStyles();
  if (level.status === 'loading') {
    return (
      <View testID="player-level-skeleton">
        <SkeletonText lines={1} />
      </View>
    );
  }
  if (level.status === 'error') return null;

  const value = level.level;
  const offer = startingLevelOffered(value) ? (
    <Button
      label="Set your starting level"
      variant="dark"
      onPress={() => router.push(STARTING_LEVEL_ROUTE)}
      fullWidth
      testID="set-starting-level"
    />
  ) : null;

  if (!value) {
    return (
      <View testID="player-level" style={styles.levelBlock}>
        <Text variant="callout" tone="onNightMuted">
          No level yet
        </Text>
        {offer}
      </View>
    );
  }

  const shown = formatLevel(value.level);
  const right = levelRightLabel(change);
  return (
    <View testID="player-level" style={styles.levelBlock}>
      <View
        style={styles.levelRow}
        accessible
        accessibilityLabel={`Level ${shown}${value.provisional ? ', provisional' : ''}, ${right.replace('▲', 'up ').replace('▼', 'down ')}`}>
        <View style={styles.levelLeft}>
          <Text variant="headline" tone="onNight" tabular testID="player-level-value">
            {`Level ${shown}`}
          </Text>
          {value.provisional ? (
            <View style={styles.tag} testID="player-level-provisional">
              <Text variant="caption" tone="onNightMuted">
                Provisional
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="callout" tone="onNightMuted" tabular testID="player-level-change">
          {right}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={styles.trackBg} />
        <View style={[styles.fill, { width: `${Math.round(levelProgress(value.level) * 100)}%` }]} />
      </View>
      {offer}
    </View>
  );
}

export function ProfileTop({ profile, summary, level, canShare, topInset, onShare, onMyCard }: ProfileTopProps) {
  const styles = useStyles();
  const name = profile.full_name || profile.username || 'Player';
  const subtitle = profileSubtitle(profile);
  const change = summary.status === 'ready' ? summary.summary.levelChangeMonth : null;

  return (
    <View testID="profile-top" style={[styles.top, { paddingTop: topInset + space.sm }]}>
      <View style={styles.topBar}>
        {canShare ? <TopLink label="Share" onPress={onShare} testID="profile-share" /> : <View />}
        <TopLink label="Settings" onPress={() => router.push('/account')} testID="profile-settings" />
      </View>

      <View style={styles.identityRow}>
        <Pressable
          testID="profile-edit-avatar"
          accessibilityRole="button"
          accessibilityLabel="Edit avatar"
          onPress={() => router.push('/edit-avatar')}
          style={({ pressed }) => pressed && styles.pressed}>
          <Avatar name={name} kit={avatarLook(profile)} size={AVATAR_SIZE} />
        </Pressable>
        <View style={styles.identity}>
          <Text variant="display" tone="onNight" numberOfLines={2} testID="profile-name">
            {name}
          </Text>
          {subtitle ? (
            <Text variant="callout" tone="onNightMuted" testID="profile-subtitle">
              {subtitle}
            </Text>
          ) : null}
          {!profile.city ? (
            <Pressable
              testID="profile-add-area"
              accessibilityRole="button"
              accessibilityLabel="Add my area"
              onPress={() => router.push('/edit-profile')}
              style={({ pressed }) => [styles.inlineLink, pressed && styles.pressed]}>
              <Text variant="callout" tone="onNight">
                Add my area
              </Text>
            </Pressable>
          ) : null}
          {summary.status === 'ready' ? (
            <Text variant="callout" tone="onNightMuted" tabular testID="profile-follow-line">
              {followLine(summary.summary)}
            </Text>
          ) : summary.status === 'loading' ? (
            <SkeletonText lines={1} />
          ) : null}
        </View>
      </View>

      <LevelRow level={level} change={change} />

      <View style={styles.actions}>
        <View style={styles.action}>
          <Button label="My card" onPress={onMyCard} fullWidth testID="profile-my-card" />
        </View>
        <Pressable
          testID="profile-edit"
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          onPress={() => router.push('/edit-profile')}
          style={({ pressed }) => [styles.action, styles.outline, pressed && styles.pressed]}>
          <Text variant="headline" tone="onNight">
            Edit profile
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors, hairline }) => ({
  top: {
    backgroundColor: colors.night,
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    gap: space.lg,
  },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topLink: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center' },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  identity: { flex: 1, gap: space.xs },
  inlineLink: { minHeight: MIN_TOUCH, justifyContent: 'center', alignSelf: 'flex-start' },
  levelBlock: { gap: space.sm },
  levelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  levelLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tag: {
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.onNightMuted,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs / 2,
  },
  track: { height: space.sm, borderRadius: radius.pill, overflow: 'hidden' },
  trackBg: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.onNightMuted, opacity: 0.3 },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.green },
  actions: { flexDirection: 'row', gap: space.md },
  action: { flex: 1 },
  outline: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.control,
    borderWidth: hairline * 2,
    borderColor: colors.onNightMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  pressed: { opacity: 0.8 },
}));
