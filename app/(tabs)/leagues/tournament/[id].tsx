// S10A: a tournament's competition page (image 13; SofaScore 07-20), from
// the server's reads (match-record.md 1o). A fixed night header and one
// scrolling child per tab, never nested: Overview, Matches (By group),
// Standings (the group tables), Player stats (Premium), Knockout, Stats and
// Power rankings. Before sign-up opens the page is Coming soon (image 17), even
// from a link. ?tab= opens a tab.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { CompetitionHeader, TOURNAMENT_TABS, type CompetitionTab } from '@/components/competition/competition-header';
import { OverviewSkeleton } from '@/components/competition/overview-tab';
import { PlayerStatsTab } from '@/components/competition/player-stats-tab';
import { PowerTab } from '@/components/competition/power-tab';
import { StatsTab } from '@/components/competition/stats-tab';
import { GroupStandingsTab } from '@/components/competition/tournament/group-standings';
import { KnockoutTab } from '@/components/competition/tournament/knockout-tab';
import { RegistrationSheet, type RegistrationMode } from '@/components/competition/tournament/registration-sheet';
import { TournamentMatchesTab } from '@/components/competition/tournament/tournament-matches-tab';
import { TournamentOverview } from '@/components/competition/tournament/tournament-overview';
import { NewTeamSheet } from '@/components/community/new-team-sheet';
import { NightHeader } from '@/components/match/night-header';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { ISLAND_WIDE, normaliseScope, scopeLabel } from '@/lib/match/league-directory';
import { tournamentHref } from '@/lib/match/league-routes';
import { registrationAction, tournamentBadge, type Tournament } from '@/lib/match/tournament-api';
import { useCompetitionPins } from '@/lib/match/use-competition-pins';
import { useTournament, useTournamentKnockout, useTournamentStandings } from '@/lib/match/use-tournament';
import { makeStyles } from '@/lib/theme';
import { useMyTeams } from '@/lib/use-my-teams';

function backToLeagues() {
  if (router.canGoBack()) router.back();
  else router.replace('/leagues');
}

const isTab = (t: unknown): t is CompetitionTab => TOURNAMENT_TABS.some((x) => x.value === t);

/** "Limassol · 5-a-side tournament". */
export function tournamentSubtitle(t: Pick<Tournament, 'area' | 'format'>): string {
  const area = normaliseScope(t.area) === ISLAND_WIDE ? 'Cyprus' : scopeLabel(t.area);
  return `${area} · ${t.format} tournament`;
}

function Body({
  tournament,
  reload,
  initialTab,
}: {
  tournament: Tournament;
  reload: () => Promise<void>;
  initialTab: CompetitionTab;
}) {
  const styles = useStyles();
  const [tab, setTab] = useState<CompetitionTab>(initialTab);
  const [visited, setVisited] = useState<Set<CompetitionTab>>(new Set([initialTab]));
  const [sheet, setSheet] = useState<RegistrationMode | null>(null);
  const [makingTeam, setMakingTeam] = useState(false);
  const pins = useCompetitionPins();
  const myTeams = useMyTeams();
  const standings = useTournamentStandings(tournament.id);
  const knockout = useTournamentKnockout(tournament.id);

  const teams = myTeams.status === 'ready' ? myTeams.teams : [];
  const myTeamIds = useMemo(() => new Set(teams.map(({ team }) => team.id)), [teams]);
  const captainIds = teams.filter((m) => m.role === 'captain' && !m.team.deleted_at).map((m) => m.team.id);
  const action = registrationAction(tournament, captainIds);
  const registered = useMemo(
    () => [...(tournament.teams ?? [])].sort((a, b) => a.teamName.localeCompare(b.teamName)),
    [tournament.teams],
  );

  const go = (next: CompetitionTab) => {
    setTab(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
  };

  const refreshAll = async () => {
    await Promise.all([reload(), standings.reload(), knockout.reload(), myTeams.reload()]);
  };

  const panel = (key: CompetitionTab, node: React.ReactNode) =>
    visited.has(key) ? (
      <View key={key} style={[styles.panel, tab !== key && styles.hidden]} testID={`competition-panel-${key}`}>
        {node}
      </View>
    ) : null;

  return (
    <>
      <CompetitionHeader
        name={tournament.name}
        subtitle={tournamentSubtitle(tournament)}
        badge={tournamentBadge(tournament.name)}
        onBack={backToLeagues}
        pin={{ pinned: pins.isTournamentPinned(tournament.id), onToggle: () => void pins.toggleTournament(tournament.id) }}
        season={null}
        tab={tab}
        onTab={go}
        tabs={TOURNAMENT_TABS}
      />
      {pins.toggleError ? (
        <Text variant="callout" tone="danger" style={styles.pinError} accessibilityLiveRegion="polite">
          {pins.toggleError}
        </Text>
      ) : null}
      {panel(
        'overview',
        <TournamentOverview
          tournament={tournament}
          action={action}
          onAction={() => action && setSheet(action)}
          onRefresh={refreshAll}
          onGoTab={go}
        />,
      )}
      {panel('matches', <TournamentMatchesTab tournamentId={tournament.id} teams={registered} onSeeStandings={() => go('standings')} />)}
      {panel('standings', <GroupStandingsTab standings={standings} myTeamIds={myTeamIds} onSeeMatches={() => go('matches')} />)}
      {panel(
        'player-stats',
        <PlayerStatsTab seasonId={tournament.id} teams={registered.map((t) => ({ id: t.teamId, name: t.teamName }))} />,
      )}
      {panel('knockout', <KnockoutTab knockout={knockout} championTeamId={tournament.championTeamId} />)}
      {panel('stats', <StatsTab seasonId={tournament.id} onSeeMatches={() => go('matches')} />)}
      {panel('power', <PowerTab seasonId={tournament.id} format={tournament.format} onSeeStandings={() => go('standings')} />)}
      <RegistrationSheet
        visible={sheet !== null}
        mode={sheet ?? 'register'}
        tournament={tournament}
        myTeams={teams}
        onClose={() => setSheet(null)}
        onDone={() => void refreshAll()}
        onMakeTeam={() => {
          setSheet(null);
          setMakingTeam(true);
        }}
      />
      <NewTeamSheet
        visible={makingTeam}
        onClose={() => setMakingTeam(false)}
        onCreated={() => {
          // Back to registration with the new team.
          void myTeams.reload().then(() => setSheet('register'));
        }}
      />
    </>
  );
}

export default function TournamentPage() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const tournament = useTournament(params.id);
  const initialTab = isTab(params.tab) ? params.tab : 'overview';
  const t = tournament.status === 'ready' ? tournament.tournament : null;

  // Coming soon, even from a link: the same screen as the Leagues list opens.
  useEffect(() => {
    if (t?.comingSoon) router.replace(tournamentHref(t));
  }, [t]);

  const notFound =
    (tournament.status === 'error' && tournament.message === 'tournament_not_found') ||
    (tournament.status === 'ready' && !t);

  return (
    <View testID="tournament-page" style={styles.screen}>
      {t && !t.comingSoon ? (
        <Body key={t.id} tournament={t} reload={tournament.reload} initialTab={initialTab} />
      ) : (
        <>
          <NightHeader title="Tournament" back={{ label: 'Leagues', onPress: backToLeagues, testID: 'league-page-back' }} />
          {tournament.status === 'loading' || t?.comingSoon ? <OverviewSkeleton /> : null}
          {notFound ? (
            <EmptyState icon="trophy.fill" message="Tournament not found" action={{ label: 'Back to leagues', onPress: backToLeagues }} />
          ) : null}
          {tournament.status === 'error' && !notFound ? (
            <View style={styles.content}>
              <Banner
                tone="danger"
                message="Couldn’t load this tournament."
                action={{ label: 'Try again', onPress: tournament.reload }}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg },
  panel: { flex: 1 },
  hidden: { display: 'none' },
  pinError: { paddingHorizontal: space.lg, paddingTop: space.sm },
}));
