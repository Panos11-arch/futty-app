import { router, useFocusEffect, useNavigation } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlayerLevelSummary } from '@/components/match/player-level';
import { ProfileMyTeams } from '@/components/match/profile-my-teams';
import { ProfileRecentGames } from '@/components/match/profile-recent-games';
import { ProfileSeasonCard } from '@/components/match/profile-season-card';
import { ProfileTop } from '@/components/match/profile-top';
import { MyCardSheet } from '@/components/navigation/my-card-sheet';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { useAuth } from '@/lib/auth';
import { avatarLook } from '@/lib/avatar';
import { usePlayerLevel } from '@/lib/match/use-levels';
import { useMyProfileRecent, useMyProfileSeason, useMyProfileSummary } from '@/lib/match/use-profile-summary';
import { cardLink, fetchMyPlayerCard } from '@/lib/player-card';
import { type Profile, useProfile } from '@/lib/use-profile';
import { useMyTeams } from '@/lib/use-my-teams';

/** Recent games shown on Profile (image 19); "All games" opens the rest. */
const RECENT_GAMES = 3;

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
            testID="profile-edit-avatar"
            accessibilityLabel="Edit avatar"
            onPress={() => router.push('/edit-avatar')}
            style={({ pressed }) => pressed && styles.pressed}>
            <Avatar name={name} kit={avatarLook(profile)} size={AVATAR_SIZE} />
          </Pressable>
        ) : (
          <Avatar name={name} kit={avatarLook(profile)} size={AVATAR_SIZE} />
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

/** The Profile tab's skeleton while the profile loads: the dark top's shape. */
function ProfileSkeleton({ topInset }: { topInset: number }) {
  const styles = useStyles();
  return (
    <View testID="profile-skeleton" style={[styles.skeletonTop, { paddingTop: topInset + space.xl }]}>
      <View style={styles.cardHeader}>
        <SkeletonBlock width={AVATAR_SIZE} height={AVATAR_SIZE} rounded="pill" />
        <View style={styles.identity}>
          <SkeletonText lines={3} />
        </View>
      </View>
      <SkeletonBlock width="100%" height={space.xxl + space.md} />
    </View>
  );
}

/**
 * S8 (docs/specs/15-design.md, image 19): the dark top with level, My card
 * and Edit profile, then This season, Recent games and My teams. The banner
 * ad and the Dream team row (S21) are not built yet. What the old Profile
 * held lives in the Account menu (bookings, payments, settings, help,
 * Premium, venue dashboard, sign out, streak, teammates, leaderboards).
 */
export default function ProfileScreen() {
  const styles = useStyles();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const profile = useProfile();
  const userId = user?.id ?? null;
  const [format, setFormat] = useState<string | null>(null);
  const [formats, setFormats] = useState<string[]>([]);
  const [cardOpen, setCardOpen] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const summary = useMyProfileSummary(userId);
  const level = usePlayerLevel(userId);
  const season = useMyProfileSeason(userId, format);
  const recent = useMyProfileRecent(userId, RECENT_GAMES);
  const teams = useMyTeams();

  // The dark top replaces the shared header on this tab only.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // The picker keeps every format played, even while one is picked. Keyed
  // on the list's text: the hook's object is new on every render.
  const playedKey = format === null && season.status === 'ready' ? season.season.formats.join('|') : null;
  useEffect(() => {
    if (playedKey !== null) setFormats(playedKey ? playedKey.split('|') : []);
  }, [playedKey]);

  // Share follows the player card: off for a minor or a player without a
  // username (my_player_card's show_qr).
  const loadShare = useCallback(async () => {
    const card = await fetchMyPlayerCard();
    setCanShare(card.status === 'ready' && card.card.show_qr && Boolean(card.card.username));
  }, []);

  const reloadAll = useCallback(async () => {
    await Promise.all([
      profile.reload(),
      summary.reload(),
      level.reload(),
      season.reload(),
      recent.reload(),
      teams.reload(),
      loadShare(),
    ]);
    // Each reload is stable; the objects around them are new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadShare]);

  // Back from Edit profile, Edit avatar or a match: show what changed.
  useFocusEffect(
    useCallback(() => {
      reloadAll();
    }, [reloadAll])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reloadAll();
    setRefreshing(false);
  }, [reloadAll]);

  const share = useCallback(async () => {
    if (profile.status !== 'ready' || !profile.profile.username) return;
    const username = profile.profile.username;
    await Share.share({ message: `Play with me on Futty: @${username} ${cardLink(username)}` });
  }, [profile]);

  let body: ReactNode;
  if (profile.status === 'loading') {
    body = <ProfileSkeleton topInset={insets.top} />;
  } else if (profile.status === 'missing' || profile.status === 'error') {
    body = (
      <View style={[styles.content, { paddingTop: insets.top + space.lg }]}>
        <Banner
          tone="danger"
          message="Your profile couldn’t load."
          action={{ label: 'Try again', onPress: reloadAll }}
        />
      </View>
    );
  } else {
    body = (
      <>
        <ProfileTop
          profile={profile.profile}
          summary={summary}
          level={level}
          canShare={canShare}
          topInset={insets.top}
          onShare={share}
          onMyCard={() => setCardOpen(true)}
        />
        <View style={styles.content}>
          <ProfileSeasonCard
            state={season}
            format={format}
            formats={formats}
            onFormat={setFormat}
            onRetry={season.reload}
          />
          <ProfileRecentGames state={recent} onRetry={recent.reload} />
          <ProfileMyTeams state={teams} onRetry={teams.reload} />
        </View>
      </>
    );
  }

  return (
    <View testID="profile-screen" style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {body}
      </ScrollView>
      <MyCardSheet visible={cardOpen} onClose={() => setCardOpen(false)} onOpenProfile={() => setCardOpen(false)} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1, paddingBottom: space.xxl },
  content: { gap: space.lg, padding: space.lg },
  skeletonTop: { backgroundColor: colors.night, padding: space.lg, gap: space.lg },
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
