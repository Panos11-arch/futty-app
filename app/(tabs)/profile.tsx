import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuRow, MenuSection } from '@/components/menu-row';
import { PlayerMatchSections } from '@/components/match/player-match-sections';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import { type Profile, useProfile } from '@/lib/use-profile';

// XP tiers, ported from the prototype's LEVEL_TIERS.
const LEVEL_TIERS = [
  { name: 'Bronze', min: 0 },
  { name: 'Silver', min: 100 },
  { name: 'Gold', min: 250 },
  { name: 'Platinum', min: 500 },
];

function tierFor(xp: number) {
  return [...LEVEL_TIERS].reverse().find((t) => xp >= t.min) ?? LEVEL_TIERS[0];
}
function nextTierFor(xp: number) {
  return LEVEL_TIERS.find((t) => t.min > xp) ?? null;
}

// Skill level (Beginner..Elite) is still self-declared-but-not-yet-editable
// placeholder — there's no profiles.skill_level column. Games/wins/goals/XP
// below are real now (supabase/scores.sql fans confirmed match results out
// to every player on both rosters).
const PLACEHOLDER_SKILL_LEVEL = 'Beginner';

/** The player's level as a neutral pill: no colour per level. */
function LevelBadge({ level }: { level: string }) {
  return (
    <View style={styles.badge} testID="level-badge">
      <Text variant="caption">{level}</Text>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statTile} accessible accessibilityLabel={`${label} ${value}`}>
      <Text variant="headline" tabular>
        {String(value)}
      </Text>
      <Text variant="caption" tone="inkMuted">
        {label}
      </Text>
    </View>
  );
}

export function ProfileCard({ profile, editable = true }: { profile: Profile; editable?: boolean }) {
  const name = profile.full_name || profile.username || 'Player';
  const tier = tierFor(profile.xp);
  const nextTier = nextTierFor(profile.xp);
  const winRate = profile.played > 0 ? Math.round((profile.won / profile.played) * 100) : 0;
  const xpProgress = nextTier ? Math.min(100, (profile.xp / nextTier.min) * 100) : 100;

  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <Avatar name={name} size={space.xxl * 2 - space.sm} />
        <View style={styles.identity}>
          <Text variant="headline">{name}</Text>
          {profile.username && profile.full_name ? (
            <Text variant="callout" tone="inkMuted">
              @{profile.username}
            </Text>
          ) : null}
          <View style={styles.identityRow}>
            <LevelBadge level={PLACEHOLDER_SKILL_LEVEL} />
            {profile.position ? (
              <Text variant="callout" tone="inkMuted">
                {profile.position}
              </Text>
            ) : null}
          </View>
          <Text variant="caption" tone="inkMuted">
            {tier.name} tier · personal level
          </Text>
        </View>
        {editable ? (
          <IconButton icon="pencil" accessibilityLabel="Edit profile" onPress={() => router.push('/edit-profile')} />
        ) : null}
      </View>

      <View style={styles.statsRow}>
        <StatTile label="Games" value={profile.played} />
        <StatTile label="Win rate" value={`${winRate}%`} />
        <StatTile label="Goals" value={profile.goals} />
      </View>

      <View style={styles.xpSection}>
        <View style={styles.xpLabels}>
          <Text variant="caption" tone="inkMuted" tabular>
            {profile.xp} XP {nextTier ? `→ ${nextTier.name}` : '(max tier)'}
          </Text>
          <Text variant="caption" tone="inkMuted" tabular>
            {nextTier ? `${nextTier.min - profile.xp} XP to go` : 'Top tier'}
          </Text>
        </View>
        <View
          style={styles.xpTrack}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="XP to the next tier"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(xpProgress) }}>
          <View style={[styles.xpFill, { width: `${xpProgress}%` }]} />
        </View>
      </View>
    </Card>
  );
}

function ProfileStatus() {
  const profile = useProfile();

  // The Profile tab stays mounted in the background when navigating to Edit
  // Profile (standard tab behavior), and useProfile only fetches once on
  // mount — without this, saved changes wouldn't show until something else
  // happened to remount the screen (e.g. switching tabs away and back).
  useFocusEffect(
    useCallback(() => {
      profile.reload();
      // profile.reload is stable (useCallback keyed on user in use-profile.ts),
      // but profile itself is a fresh object every render — depending on it
      // directly would refetch on every focus-unrelated re-render too.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  switch (profile.status) {
    case 'loading':
      return (
        <Card testID="profile-skeleton" style={styles.card}>
          <View style={styles.cardHeader}>
            <SkeletonBlock width={space.xxl * 2 - space.sm} height={space.xxl * 2 - space.sm} rounded="pill" />
            <View style={styles.identity}>
              <SkeletonText lines={3} />
            </View>
          </View>
          <SkeletonBlock width="100%" height={space.xxl * 2} />
        </Card>
      );
    case 'ready':
      return (
        <>
          <ProfileCard profile={profile.profile} />

          {/* A3b-2b: form, recent matches and "Players you play with most". */}
          <PlayerMatchSections profileId={profile.profile.id} own />

          {/* App lock and push-notification toggles live under Account >
              Settings now (app/account/settings/*) — Profile stays focused
              on identity/stats, one card, one job. */}
          {/* Spec 17 U5: My bookings, Payments, Settings and Help rows. Same
              targets as the Account menu (app/account/index.tsx). */}
          <MenuSection>
            <MenuRow icon="sportscourt.fill" label="My bookings" onPress={() => router.push('/my-bookings')} />
            <MenuRow icon="creditcard.fill" label="Payments" onPress={() => router.push('/account/payments')} />
            <MenuRow icon="gearshape.fill" label="Account & settings" onPress={() => router.push('/account')} />
            <MenuRow icon="questionmark.circle.fill" label="Help" onPress={() => router.push('/account/help')} />
          </MenuSection>

          <MenuSection>
            <MenuRow
              icon="star.fill"
              label={profile.profile.is_premium ? 'Manage Premium' : 'Go Premium'}
              sublabel={profile.profile.is_premium ? undefined : 'Futty Premium'}
              onPress={() => router.push('/account/premium')}
            />
            {profile.profile.role === 'venue_owner' ? (
              <MenuRow
                icon="building.columns.fill"
                label="Venue dashboard"
                onPress={() => router.push('/venue-dashboard')}
              />
            ) : null}
          </MenuSection>
        </>
      );
    case 'missing':
      return <Banner tone="warning" message="We couldn’t find your profile — try signing up again." />;
    case 'error':
      return (
        <Banner
          tone="danger"
          message={`Couldn’t load your profile: ${profile.message}`}
          action={{ label: 'Try again', onPress: profile.reload }}
        />
      );
  }
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text variant={Platform.OS === 'ios' ? 'display' : 'title'} accessibilityRole="header">
            Profile
          </Text>
          <Text variant="callout" tone="inkMuted">
            {user?.email}
          </Text>
        </View>

        <ProfileStatus />

        <MenuSection>
          <MenuRow icon="rectangle.portrait.and.arrow.right" label="Sign out" destructive onPress={signOut} />
        </MenuSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  header: { gap: space.xs },
  card: { gap: space.lg },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  identity: { flex: 1, gap: space.xs },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: {
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs / 2,
  },
  statsRow: { flexDirection: 'row', gap: space.sm },
  statTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.control,
    backgroundColor: colors.canvas,
  },
  xpSection: { gap: space.xs },
  xpLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  xpTrack: { height: space.sm, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  xpFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.inkMuted },
});
