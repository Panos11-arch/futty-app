import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FollowButton } from '@/components/match/follow-button';
import { FormChips } from '@/components/match/form-chips';
import { TeamHeadToHead } from '@/components/match/head-to-head';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { useTeamForm } from '@/lib/match/use-profile-matches';
import { supabase } from '@/lib/supabase';
import { getTeamRoster, type RosterMember, type Team } from '@/lib/teams';
import { useMyTeams } from '@/lib/use-my-teams';
import { xpTier } from '@/lib/xp-tier';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; team: Team; roster: RosterMember[] };

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <Card style={styles.statTile}>
      <View style={styles.statInner} accessible accessibilityLabel={`${label} ${value}`}>
        <Text variant="headline" tabular>
          {String(value)}
        </Text>
        <Text variant="caption" tone="inkMuted">
          {label}
        </Text>
      </View>
    </Card>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Read-only public stats for a team (item 5) — reachable by tapping a
 *  followed team in Community. teams and get_team_roster() are already
 *  public to any signed-in user (supabase/teams.sql). A3b-2b adds the team's
 *  form (team_form), a follow button for teams the viewer isn't in, and the
 *  head-to-head when the viewer captains another team. */
export default function TeamProfileScreen() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const form = useTeamForm(teamId);
  const myTeams = useMyTeams();

  useEffect(() => {
    let active = true;

    async function load() {
      if (!teamId) {
        setState({ status: 'error', message: 'Missing team.' });
        return;
      }
      setState({ status: 'loading' });

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
        setState({ status: 'error', message: teamError ? 'Couldn’t load this team.' : 'Team not found.' });
        return;
      }

      setState({ status: 'ready', team, roster: rosterError ? [] : (roster ?? []) });
    }

    load();
    return () => {
      active = false;
    };
  }, [teamId, attempt]);

  const mine = myTeams.status === 'ready' ? myTeams.teams : [];
  const isMember = mine.some(({ team }) => team.id === teamId);
  const captainOf = mine.filter(({ role, team }) => role === 'captain' && team.id !== teamId).map(({ team }) => team);

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {state.status === 'loading' ? (
          <View testID="team-profile-skeleton">
            <SkeletonText lines={4} />
          </View>
        ) : null}
        {state.status === 'error' ? (
          <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: retry }} />
        ) : null}

        {state.status === 'ready' ? (
          <>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text variant="title" accessibilityRole="header">
                  {state.team.name}
                </Text>
                <Text variant="callout" tone="inkMuted">
                  {`${state.team.city ?? 'Unknown city'} · ${xpTier(state.team.xp)} tier`}
                </Text>
              </View>
              {myTeams.status === 'ready' && !isMember ? (
                <FollowButton targetType="team" targetId={state.team.id} name={state.team.name} />
              ) : null}
            </View>

            <View style={styles.statsGrid}>
              <StatTile label="Played" value={state.team.played} />
              <StatTile
                label="Win rate"
                value={state.team.played > 0 ? `${Math.round((state.team.won / state.team.played) * 100)}%` : '0%'}
              />
              <StatTile label="Goals" value={state.team.goals} />
            </View>

            <View style={styles.section}>
              <SectionHeader title="Form" />
              <FormChips
                form={form.status === 'ready' ? form.form : []}
                loading={form.status === 'loading'}
                error={form.status === 'error'}
                onRetry={form.reload}
              />
            </View>

            {captainOf.length > 0 ? (
              <HeadToHeadSection captainOf={captainOf} opponent={state.team} />
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="Roster" />
              {state.roster.length === 0 ? (
                <Text variant="callout" tone="inkMuted">
                  No players listed yet.
                </Text>
              ) : (
                <Card padded={false}>
                  {state.roster.map((member) => {
                    const name = member.full_name || member.username || 'Player';
                    return (
                      <ListRow
                        key={member.profile_id}
                        title={name}
                        leading={{ avatar: { name } }}
                        trailing={
                          <Text variant="caption" tone="inkMuted">
                            {capitalise(member.role)}
                          </Text>
                        }
                      />
                    );
                  })}
                </Card>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The viewer's team against this one; a captain of several teams picks which. */
function HeadToHeadSection({ captainOf, opponent }: { captainOf: Team[]; opponent: Team }) {
  const [pickedId, setPickedId] = useState(captainOf[0].id);
  const mine = captainOf.find((t) => t.id === pickedId) ?? captainOf[0];
  return (
    <View style={styles.section} testID="team-head-to-head">
      <SectionHeader title="Head-to-head" />
      {captainOf.length > 1 ? (
        <View style={styles.chips}>
          {captainOf.map((t) => (
            <Chip key={t.id} label={t.name} selected={t.id === mine.id} onPress={() => setPickedId(t.id)} />
          ))}
        </View>
      ) : null}
      <TeamHeadToHead teamId={mine.id} opponentTeamId={opponent.id} teamName={mine.name} opponentName={opponent.name} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: space.lg,
    gap: space.xl,
    paddingBottom: space.xxl,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerText: { flex: 1, gap: space.xs },
  statsGrid: {
    flexDirection: 'row',
    gap: space.sm,
  },
  statTile: { flex: 1 },
  statInner: { alignItems: 'center', gap: 2 },
  section: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
