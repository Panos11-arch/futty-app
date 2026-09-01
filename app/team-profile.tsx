import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getTeamRoster, type RosterMember, type Team } from '@/lib/teams';
import { supabase } from '@/lib/supabase';
import { xpTier } from '@/lib/xp-tier';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; team: Team; roster: RosterMember[] };

function StatTile({ label, value }: { label: string; value: string | number }) {
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  return (
    <View style={[styles.statTile, { borderColor: border }]}>
      <ThemedText type="defaultSemiBold">{value}</ThemedText>
      <ThemedText style={styles.note}>{label}</ThemedText>
    </View>
  );
}

/** Read-only public stats for a team (item 5) — reachable by tapping a
 *  followed team in Community. teams and get_team_roster() are already
 *  public to any signed-in user (supabase/teams.sql), so no new RLS is
 *  needed here — only the profiles table needed a new RPC
 *  (supabase/public-profiles.sql), which this screen doesn't touch. */
export default function TeamProfileScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

  useEffect(() => {
    let active = true;

    async function load() {
      if (!teamId) {
        setState({ status: 'error', message: 'Missing team.' });
        return;
      }

      const [{ data: team, error: teamError }, { data: roster, error: rosterError }] = await Promise.all([
        supabase
          .from('teams')
          .select('id, name, city, created_by, xp, played, won, drawn, lost, goals, roster_size, substitute_slots, premium_9aside, premium_11aside, created_at')
          .eq('id', teamId)
          .maybeSingle(),
        getTeamRoster(teamId),
      ]);

      if (!active) return;

      if (teamError || !team) {
        setState({ status: 'error', message: teamError?.message ?? 'Team not found.' });
        return;
      }

      setState({ status: 'ready', team, roster: rosterError ? [] : (roster ?? []) });
    }

    load();
    return () => {
      active = false;
    };
  }, [teamId]);

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
          <>
            <View>
              <ThemedText type="title">{state.team.name}</ThemedText>
              <ThemedText style={styles.note}>
                {state.team.city ?? 'Unknown city'} · {xpTier(state.team.xp)} tier
              </ThemedText>
            </View>

            <View style={styles.statsGrid}>
              <StatTile label="Played" value={state.team.played} />
              <StatTile
                label="Win rate"
                value={state.team.played > 0 ? `${Math.round((state.team.won / state.team.played) * 100)}%` : '0%'}
              />
              <StatTile label="Goals" value={state.team.goals} />
            </View>

            <ThemedText type="defaultSemiBold">Roster</ThemedText>
            {state.roster.length === 0 ? (
              <ThemedText style={styles.note}>No players listed yet.</ThemedText>
            ) : (
              state.roster.map((member) => (
                <ThemedView key={member.profile_id} style={[styles.rosterRow, { borderColor: border }]}>
                  <ThemedText style={styles.rosterName}>{member.full_name || member.username || 'Player'}</ThemedText>
                  <ThemedText style={styles.rosterRole}>{member.role}</ThemedText>
                </ThemedView>
              ))
            )}
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
    padding: 16,
    gap: 12,
    paddingBottom: 48,
  },
  center: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  note: {
    fontSize: 13,
    opacity: 0.7,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  statTile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rosterName: {
    fontSize: 14,
    fontFamily: FuttyFonts.sansMedium,
  },
  rosterRole: {
    fontSize: 12,
    color: FuttyColors.stone500,
    textTransform: 'capitalize',
  },
});
