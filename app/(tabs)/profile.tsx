import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconLabel } from '@/components/icon-label';
import { PlayerMatchSections } from '@/components/match/player-match-sections';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import { type Profile, useProfile } from '@/lib/use-profile';

// Self-declared level (Beginner..Elite) shown as a badge on the card, ported
// from the prototype's SKILL_LEVELS map — reuses the existing palette rather
// than adding new colors.
const SKILL_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  Beginner: { bg: FuttyColors.stone200, text: FuttyColors.stone700 },
  Casual: { bg: FuttyColors.emerald200, text: FuttyColors.emerald800 },
  Intermediate: { bg: FuttyColors.emerald600, text: FuttyColors.white },
  Advanced: { bg: FuttyColors.amber400, text: FuttyColors.stone900 },
  Elite: { bg: FuttyColors.rose600, text: FuttyColors.white },
};

// XP tiers, ported from the prototype's LEVEL_TIERS.
const LEVEL_TIERS = [
  { name: 'Bronze', min: 0, color: FuttyColors.stone500 },
  { name: 'Silver', min: 100, color: FuttyColors.stone400 },
  { name: 'Gold', min: 250, color: FuttyColors.amber400 },
  { name: 'Platinum', min: 500, color: FuttyColors.rose600 },
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

function SkillBadge({ level }: { level: string }) {
  const colors = SKILL_BADGE_COLORS[level] ?? SKILL_BADGE_COLORS.Beginner;
  return (
    <View style={[styles.skillBadge, { backgroundColor: colors.bg }]}>
      <ThemedText style={[styles.skillBadgeText, { color: colors.text }]}>{level}</ThemedText>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statTile}>
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText style={styles.statLabel}>{label}</ThemedText>
    </View>
  );
}

export function ProfileCard({ profile, editable = true }: { profile: Profile; editable?: boolean }) {
  const name = profile.full_name || profile.username || 'Player';
  const initial = name[0]?.toUpperCase() ?? '?';
  const tier = tierFor(profile.xp);
  const nextTier = nextTierFor(profile.xp);
  const winRate = profile.played > 0 ? Math.round((profile.won / profile.played) * 100) : 0;
  const xpProgress = nextTier ? Math.min(100, (profile.xp / nextTier.min) * 100) : 100;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={styles.avatar}>
            <ThemedText style={styles.avatarText}>{initial}</ThemedText>
          </View>
          <View style={styles.identity}>
            <ThemedText style={styles.name}>{name}</ThemedText>
            {profile.username && profile.full_name ? (
              <ThemedText style={styles.username}>@{profile.username}</ThemedText>
            ) : null}
            <View style={styles.identityRow}>
              <SkillBadge level={PLACEHOLDER_SKILL_LEVEL} />
              {profile.position ? (
                <ThemedText style={styles.position}>{profile.position}</ThemedText>
              ) : null}
            </View>
            <ThemedText style={[styles.tierLine, { color: tier.color }]}>
              {tier.name} tier · personal level
            </ThemedText>
          </View>
        </View>
        {editable ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/edit-profile')}
            style={styles.editButton}>
            <IconSymbol name="pencil" size={14} color={FuttyColors.emerald950} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.statsGrid}>
        <StatTile label="Games" value={profile.played} />
        <StatTile label="Win rate" value={`${winRate}%`} />
        <StatTile label="Goals" value={profile.goals} />
      </View>

      <View style={styles.xpSection}>
        <View style={styles.xpLabels}>
          <ThemedText style={styles.xpText}>
            {profile.xp} XP {nextTier ? `→ ${nextTier.name}` : '(max tier)'}
          </ThemedText>
          <ThemedText style={styles.xpText}>
            {nextTier ? `${nextTier.min - profile.xp} XP to go` : 'Top tier'}
          </ThemedText>
        </View>
        <View style={styles.xpTrack}>
          <View style={[styles.xpFill, { width: `${xpProgress}%` }]} />
        </View>
      </View>
    </View>
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
      return <ThemedText>Loading your profile…</ThemedText>;
    case 'ready':
      return (
        <>
          <ProfileCard profile={profile.profile} />

          {/* A3b-2b: form, recent matches and "Players you play with most". */}
          <PlayerMatchSections profileId={profile.profile.id} own />

          <View style={styles.card}>
            <View style={styles.premiumRow}>
              {profile.profile.is_premium ? (
                <View style={styles.premiumBadge}>
                  <IconLabel
                    icon="star.fill"
                    style={styles.premiumBadgeText}
                    iconColor={FuttyColors.emerald950}
                    iconSize={11}
                    gap={3}>
                    Premium
                  </IconLabel>
                </View>
              ) : (
                <ThemedText style={styles.settingsRowLabel}>Futty Premium</ThemedText>
              )}
              <Pressable accessibilityRole="button" onPress={() => router.push('/account/premium')}>
                <ThemedText type="link">
                  {profile.profile.is_premium ? 'Manage Premium' : 'Go Premium'}
                </ThemedText>
              </Pressable>
            </View>
          </View>

          {profile.profile.role === 'venue_owner' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/venue-dashboard')}
              style={styles.accountLinkRow}>
              <IconSymbol name="building.columns.fill" size={16} color={FuttyColors.stone500} />
              <ThemedText style={styles.accountLinkText}>Venue Dashboard</ThemedText>
              <IconSymbol name="chevron.right" size={16} color={FuttyColors.stone400} />
            </Pressable>
          ) : null}

          {/* App lock and push-notification toggles live under Account >
              Settings now (app/account/settings/*) — Profile stays focused
              on identity/stats, one card, one job. */}
          <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={styles.accountLinkRow}>
            <IconSymbol name="gearshape.fill" size={16} color={FuttyColors.stone500} />
            <ThemedText style={styles.accountLinkText}>Account & settings</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={FuttyColors.stone400} />
          </Pressable>
        </>
      );
    case 'missing':
      return <ThemedText>We couldn&apos;t find your profile — try signing up again.</ThemedText>;
    case 'error':
      return <ThemedText>Couldn&apos;t load your profile: {profile.message}</ThemedText>;
  }
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <IconLabel icon="person.fill" type="title" iconSize={26}>Profile</IconLabel>
          <ThemedText style={styles.signedInAs}>{user?.email}</ThemedText>
        </View>

        <ProfileStatus />

        <Pressable accessibilityRole="button" onPress={signOut} style={styles.signOutRow}>
          <IconSymbol name="rectangle.portrait.and.arrow.right" size={14} color={FuttyColors.rose600} />
          <ThemedText style={styles.signOut}>Sign out</ThemedText>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 12,
    padding: 16,
    paddingBottom: 48,
  },
  signedInAs: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  card: {
    backgroundColor: FuttyColors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: FuttyColors.emerald950,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontFamily: FuttyFonts.display,
    fontSize: 18,
    color: FuttyColors.white,
  },
  identity: {
    gap: 4,
    flexShrink: 1,
  },
  name: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 15,
    color: FuttyColors.stone900,
  },
  username: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  position: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
  tierLine: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 11,
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: FuttyColors.stone50,
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  skillBadgeText: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 11,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  statTile: {
    flex: 1,
    backgroundColor: FuttyColors.stone50,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: FuttyFonts.monoSemiBold,
    fontSize: 16,
    color: FuttyColors.stone900,
  },
  statLabel: {
    fontFamily: FuttyFonts.sans,
    fontSize: 10,
    color: FuttyColors.stone500,
    marginTop: 2,
  },
  xpSection: {
    gap: 4,
  },
  xpLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  xpText: {
    fontFamily: FuttyFonts.sans,
    fontSize: 11,
    color: FuttyColors.stone500,
  },
  xpTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: FuttyColors.stone200,
    overflow: 'hidden',
  },
  xpFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: FuttyColors.amber400,
  },
  premiumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  premiumBadge: {
    backgroundColor: FuttyColors.amber400,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  premiumBadgeText: {
    color: FuttyColors.stone900,
    fontSize: 12,
    fontWeight: '700',
  },
  settingsRowLabel: {
    flex: 1,
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 13,
    color: FuttyColors.stone900,
  },
  accountLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: FuttyColors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    padding: 14,
  },
  accountLinkText: {
    flex: 1,
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 13,
    color: FuttyColors.stone900,
  },
  signOutRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  signOut: {
    color: FuttyColors.rose600,
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 14,
  },
});
