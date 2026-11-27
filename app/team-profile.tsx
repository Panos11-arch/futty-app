import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdBanner } from '@/components/ads/ad-banner';
import { FollowButton } from '@/components/match/follow-button';
import { FormChips } from '@/components/match/form-chips';
import { TeamHeadToHead } from '@/components/match/head-to-head';
import { RecentMatches } from '@/components/match/recent-matches';
import { SeasonPicker, TeamSeasonStatsView, type SeasonPick } from '@/components/match/season-stats';
import { TeamBadge } from '@/components/match/team-badge';
import { TeamPowerRanking } from '@/components/match/team-power-ranking';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { cyprusYear } from '@/lib/match/stats-api';
import { useTeamForm } from '@/lib/match/use-profile-matches';
import { useTeamRecentMatches, useTeamSeasonStats } from '@/lib/match/use-stats';
import { supabase } from '@/lib/supabase';
import { profileHref } from '@/lib/messages';
import { fetchTeamCompetitions, getTeamRoster, type RosterMember, type Team, type TeamCompetition } from '@/lib/teams';
import { useMyTeams } from '@/lib/use-my-teams';
import { xpTier } from '@/lib/xp-tier';
import { avatarLook } from '@/lib/avatar';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; team: Team; roster: RosterMember[] };

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Read-only public stats for a team (item 5) — reachable by tapping a
 *  followed team in Community. teams and get_team_roster() are already
 *  public to any signed-in user (supabase/teams.sql). A3b-2b adds the team's
 *  form (team_form), a follow button for teams the viewer isn't in, and the
 *  head-to-head when the viewer captains another team. A7 replaces the old
 *  counters (teams.played/won/goals) with the season stats from confirmed
 *  matches and adds the team's recent matches. */
export default function TeamProfileScreen() {
  const styles = useStyles();
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const form = useTeamForm(teamId);
  const recent = useTeamRecentMatches(teamId);
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
          .select('id, name, city, created_by, xp, played, won, drawn, lost, goals, roster_size, substitute_slots, premium_9aside, premium_11aside, created_at, kit_colour, deleted_at')
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
    <SafeAreaView style={styles.screen} edges={['bottom']}>
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
              <TeamBadge name={state.team.name} kitColour={state.team.kit_colour} size={space.xxl + space.lg} />
              <View style={styles.headerText}>
                <Text variant="title" accessibilityRole="header">
                  {state.team.name}
                </Text>
                <Text variant="callout" tone="inkMuted">
                  {state.team.deleted_at
                    ? 'Deleted team'
                    : `${state.team.city ?? 'Unknown city'} · ${xpTier(state.team.xp)} tier`}
                </Text>
              </View>
              {myTeams.status === 'ready' && !isMember && !state.team.deleted_at ? (
                <FollowButton targetType="team" targetId={state.team.id} name={state.team.name} />
              ) : null}
            </View>

            <TeamPowerRanking teamId={state.team.id} />

            {state.team.deleted_at ? null : <TeamLeagues teamId={state.team.id} />}

            <TeamSeason teamId={state.team.id} />

            <View style={styles.section}>
              <SectionHeader title="Form" />
              <FormChips
                form={form.status === 'ready' ? form.form : []}
                loading={form.status === 'loading'}
                error={form.status === 'error'}
                onRetry={form.reload}
              />
            </View>

            <View style={styles.section}>
              <SectionHeader title="Recent matches" />
              <RecentMatches state={recent} onRetry={recent.reload} />
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
                        leading={{ avatar: { name, kit: avatarLook(member) } }}
                        onPress={() => router.push(profileHref(member.profile_id))}
                        accessibilityLabel={`${name}, ${capitalise(member.role)}`}
                        testID={`team-member-${member.profile_id}`}
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
            {/* G4a: a banner ad on another team's page, never one you play for. */}
            {myTeams.status === 'ready' && !isMember ? <AdBanner testID="team-profile-ad" /> : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

type LeaguesState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; rows: TeamCompetition[] };

/** S20A: the leagues the team plays in; each opens its competition page. Hidden when none. */
function TeamLeagues({ teamId }: { teamId: string }) {
  const styles = useStyles();
  const [state, setState] = useState<LeaguesState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    fetchTeamCompetitions(teamId).then(
      (rows) => active && setState({ status: 'ready', rows }),
      (e: Error) => active && setState({ status: 'error', message: e.message }),
    );
    return () => {
      active = false;
    };
  }, [teamId, attempt]);

  if (state.status === 'loading' || (state.status === 'ready' && state.rows.length === 0)) return null;
  return (
    <View style={styles.section} testID="team-leagues">
      <SectionHeader title="Leagues" />
      {state.status === 'error' ? (
        <View style={styles.chips}>
          <Text variant="callout" tone="danger">
            {state.message}
          </Text>
          <Button label="Try again" variant="plain" onPress={() => setAttempt((n) => n + 1)} testID="team-leagues-retry" />
        </View>
      ) : (
        <Card padded={false}>
          {state.rows.map((league) => (
            <ListRow
              key={league.league_id}
              title={league.name}
              subtitle={league.format}
              chevron
              onPress={() => router.push({ pathname: '/leagues/[id]', params: { id: league.league_id } })}
              testID={`team-league-${league.league_id}`}
            />
          ))}
        </Card>
      )}
    </View>
  );
}

/** A7: the team's season (this year in Cyprus time, or all time), from team_season_stats. */
function TeamSeason({ teamId }: { teamId: string }) {
  const styles = useStyles();
  const [pick, setPick] = useState<SeasonPick>('year');
  const stats = useTeamSeasonStats(teamId, pick === 'year' ? { kind: 'year', year: cyprusYear() } : { kind: 'all' });
  return (
    <View style={styles.section} testID="team-season">
      <SectionHeader title="Season" />
      <SeasonPicker value={pick} onChange={setPick} />
      <TeamSeasonStatsView
        state={stats.status === 'ready' ? { status: 'ready', stats: stats.stats } : stats}
        onRetry={stats.reload}
      />
    </View>
  );
}

/** The viewer's team against this one; a captain of several teams picks which. */
function HeadToHeadSection({ captainOf, opponent }: { captainOf: Team[]; opponent: Team }) {
  const styles = useStyles();
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

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
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
  section: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
