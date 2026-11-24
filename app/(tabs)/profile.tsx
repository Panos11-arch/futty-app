import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { MenuRow, MenuSection } from '@/components/menu-row';
import { PlayerLevelSummary } from '@/components/match/player-level';
import { PlayerMatchSections } from '@/components/match/player-match-sections';
import { StreakCard } from '@/components/stats/streak-card';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { useAuth } from '@/lib/auth';
import { avatarKit } from '@/lib/avatar';
import { isPremiumPlayer } from '@/lib/premium';
import { type Profile, useProfile } from '@/lib/use-profile';
import { isVenueStaff } from '@/lib/venue-staff';

// A5b (docs/specs/match-record.md decision 1f.6): the skill level from
// player_levels replaces the XP bar and tier. Games, wins and goals below are
// real (supabase/scores.sql fans confirmed match results out to every player
// on both rosters).

/** 56 points: above the 44-point touch minimum, so the avatar is its own button. */
const AVATAR_SIZE = space.xxl * 2 - space.sm;

function StatTile({ label, value }: { label: string; value: string | number }) {
  const styles = useStyles();
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
  const styles = useStyles();
  const name = profile.full_name || profile.username || 'Player';
  const winRate = profile.played > 0 ? Math.round((profile.won / profile.played) * 100) : 0;

  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        {editable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit avatar"
            onPress={() => router.push('/edit-avatar')}
            style={({ pressed }) => pressed && styles.pressed}>
            <Avatar name={name} kit={avatarKit(profile)} size={AVATAR_SIZE} />
          </Pressable>
        ) : (
          <Avatar name={name} kit={avatarKit(profile)} size={AVATAR_SIZE} />
        )}
        <View style={styles.identity}>
          <Text variant="headline">{name}</Text>
          {profile.username && profile.full_name ? (
            <Text variant="callout" tone="inkMuted">
              @{profile.username}
            </Text>
          ) : null}
          {profile.position ? (
            <Text variant="callout" tone="inkMuted">
              {profile.position}
            </Text>
          ) : null}
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

      <PlayerLevelSummary profileId={profile.id} own={editable} />
    </Card>
  );
}

function ProfileStatus() {
  const styles = useStyles();
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
            <SkeletonBlock width={AVATAR_SIZE} height={AVATAR_SIZE} rounded="pill" />
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

          {/* A11: weekly streak and streak badges (match-record decision 1i). */}
          <StreakCard />

          {/* A3b-2b: form, recent matches and "Players you play with most". */}
          <PlayerMatchSections profileId={profile.profile.id} own />

          {/* App lock and push-notification toggles live under Account >
              Settings now (app/account/settings/*) — Profile stays focused
              on identity/stats, one card, one job. */}
          {/* Spec 17 U5: My bookings, Payments, Settings and Help rows. Same
              targets as the Account menu (app/account/index.tsx). */}
          <MenuSection>
            <MenuRow
              testID="profile-my-bookings"
              icon="sportscourt.fill"
              label="My bookings"
              onPress={() => router.push('/my-bookings')}
            />
            <MenuRow icon="creditcard.fill" label="Payments" onPress={() => router.push('/account/payments')} />
            <MenuRow icon="gearshape.fill" label="Account & settings" onPress={() => router.push('/account')} />
            <MenuRow icon="questionmark.circle.fill" label="Help" onPress={() => router.push('/account/help')} />
          </MenuSection>

          <MenuSection>
            <MenuRow
              icon="star.fill"
              label={isPremiumPlayer(profile) ? 'Manage Premium' : 'Go Premium'}
              sublabel={isPremiumPlayer(profile) ? undefined : 'Futty Premium'}
              onPress={() => router.push('/account/premium')}
            />
            {isVenueStaff(profile) ? (
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
  const styles = useStyles();
  const { user, signOut } = useAuth();

  return (
    <View testID="profile-screen" style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text variant="callout" tone="inkMuted">
            {user?.email}
          </Text>
        </View>

        <ProfileStatus />

        <MenuSection>
          <MenuRow icon="rectangle.portrait.and.arrow.right" label="Sign out" destructive onPress={signOut} />
        </MenuSection>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  header: { gap: space.xs },
  card: { gap: space.lg },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  identity: { flex: 1, gap: space.xs },
  statsRow: { flexDirection: 'row', gap: space.sm },
  pressed: { opacity: 0.8 },
  statTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.control,
    backgroundColor: colors.canvas,
  },
}));
