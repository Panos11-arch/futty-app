import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileCard } from '@/app/(tabs)/profile';
import { PlayerMatchSections } from '@/components/match/player-match-sections';
import { Banner } from '@/components/ui/banner';
import { SkeletonText } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import { getPublicProfile, publicProfileAsProfile, type PublicProfile } from '@/lib/use-profile';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; profile: PublicProfile };

/** Read-only public stats for another player (item 5) — reachable by
 *  tapping a matched contact. Only ever shows what
 *  supabase/public-profiles.sql's get_public_profile() returns (level,
 *  games played, goals, win rate, position) — never email, phone, gender or
 *  date of birth, which that RPC never selects in the first place. Below
 *  it, the player's form and recent matches from the A3b views; "Players
 *  you play with most" shows only on the viewer's own profile. */
export default function PlayerProfileScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const { user } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    if (!profileId) {
      setState({ status: 'error', message: 'Missing player.' });
      return;
    }
    setState({ status: 'loading' });
    getPublicProfile(profileId).then(({ data, error }) => {
      if (!active) return;
      if (error || !data) {
        setState({ status: 'error', message: error ? 'Couldn’t load this player.' : 'Player not found.' });
      } else {
        setState({ status: 'ready', profile: data });
      }
    });
    return () => {
      active = false;
    };
  }, [profileId, attempt]);

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {state.status === 'loading' ? (
          <View testID="player-profile-skeleton">
            <SkeletonText lines={4} />
          </View>
        ) : null}
        {state.status === 'error' ? (
          <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: retry }} />
        ) : null}
        {state.status === 'ready' ? (
          <>
            <ProfileCard profile={publicProfileAsProfile(state.profile)} editable={false} />
            <PlayerMatchSections profileId={state.profile.id} own={state.profile.id === user?.id} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: space.lg,
    gap: space.xl,
  },
});
