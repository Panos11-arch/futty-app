import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileCard } from '@/app/(tabs)/profile';
import { ThemedText } from '@/components/themed-text';
import { getPublicProfile, publicProfileAsProfile, type PublicProfile } from '@/lib/use-profile';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; profile: PublicProfile };

/** Read-only public stats for another player (item 5) — reachable by
 *  tapping a matched contact. Only ever shows what
 *  supabase/public-profiles.sql's get_public_profile() returns (level,
 *  games played, goals, win rate, position) — never email, phone, gender or
 *  date of birth, which that RPC never selects in the first place. */
export default function PlayerProfileScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    if (!profileId) {
      setState({ status: 'error', message: 'Missing player.' });
      return;
    }
    getPublicProfile(profileId).then(({ data, error }) => {
      if (!active) return;
      if (error || !data) {
        setState({ status: 'error', message: error?.message ?? 'Player not found.' });
      } else {
        setState({ status: 'ready', profile: data });
      }
    });
    return () => {
      active = false;
    };
  }, [profileId]);

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {state.status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : null}
        {state.status === 'error' ? <ThemedText style={styles.note}>{state.message}</ThemedText> : null}
        {state.status === 'ready' ? (
          <ProfileCard profile={publicProfileAsProfile(state.profile)} editable={false} />
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
    padding: 16,
    gap: 12,
  },
  center: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  note: {
    fontSize: 13,
    opacity: 0.7,
  },
});
