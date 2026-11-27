import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { LeaguesTab } from '@/components/match/leagues-tab';
import { MatchesTab } from '@/components/match/matches-tab';
import { NightHeader, type NightTab } from '@/components/match/night-header';
import { cyprusDateKey } from '@/lib/days';
import type { League } from '@/lib/leagues';
import { buildLeagueDirectory, competitionKey } from '@/lib/match/league-directory';
import type { TournamentHeader } from '@/lib/match/tournament-api';
import { useCompetitionPins } from '@/lib/match/use-competition-pins';
import { useTournaments } from '@/lib/match/use-tournament';
import { makeStyles } from '@/lib/theme';
import { useLeagues } from '@/lib/use-leagues';
import { useMyTeams } from '@/lib/use-my-teams';

type Tab = 'matches' | 'leagues';

const TABS: NightTab<Tab>[] = [
  { value: 'matches', label: 'Matches', testID: 'leagues-tab-matches' },
  { value: 'leagues', label: 'Leagues', testID: 'leagues-tab-leagues' },
];

/**
 * S9: Home → Leagues (image 12; sofascore-01, 05, 06). MATCHES: league
 * fixtures by day and competition. LEAGUES: Pinned, the Cyprus Open League
 * and each city with all five formats. The star on MATCHES and the Pin on
 * LEAGUES are the same server pin (competition_pins). S10A: the Tournaments
 * group and tournament pins (tournament_pins).
 */
export default function LeaguesScreen() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'matches' ? 'matches' : 'leagues');
  // Once opened, a tab stays mounted (hidden when not selected), so switching
  // back keeps its place and doesn't refetch.
  const [opened, setOpened] = useState<ReadonlySet<Tab>>(() => new Set([tab]));
  const [today] = useState(() => cyprusDateKey(new Date()));

  const leagues = useLeagues();
  const pins = useCompetitionPins();
  const myTeams = useMyTeams();
  const tournaments = useTournaments();

  // A pull to refresh keeps the last list on screen instead of a skeleton.
  const lastLeagues = useRef<League[] | null>(null);
  if (leagues.status === 'ready') lastLeagues.current = leagues.leagues;
  const lastTournaments = useRef<TournamentHeader[] | null>(null);
  if (tournaments.status === 'ready') lastTournaments.current = tournaments.tournaments;
  const [refreshing, setRefreshing] = useState(false);

  const leagueRows = leagues.status === 'ready' ? leagues.leagues : refreshing ? lastLeagues.current : null;
  const tournamentRows =
    tournaments.status === 'ready' ? tournaments.tournaments : refreshing ? lastTournaments.current : null;
  const directory = useMemo(
    () =>
      leagueRows && tournamentRows && pins.status === 'ready'
        ? buildLeagueDirectory(leagueRows, pins.pins, { tournaments: tournamentRows })
        : null,
    [leagueRows, tournamentRows, pins.status, pins.pins],
  );

  const myTeamIds = useMemo(
    () => new Set(myTeams.status === 'ready' ? myTeams.teams.map(({ team }) => team.id) : []),
    [myTeams],
  );
  const pinnedKeys = useMemo(
    () => new Set(pins.pins.flatMap((p) => (p.target_type === 'league' ? [competitionKey(p.scope, p.format)] : []))),
    [pins.pins],
  );
  const names = useMemo(
    () => new Map(directory ? [directory.open, ...directory.cities].flatMap((g) => g.entries.map((e) => [e.key, e.name] as const)) : []),
    [directory],
  );
  const cities = useMemo(() => (directory ? directory.cities.map((c) => ({ scope: c.scope, label: c.label })) : []), [directory]);

  const retry = useCallback(() => {
    void leagues.reload();
    void pins.reload();
    void tournaments.reload();
  }, [leagues, pins, tournaments]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([leagues.reload(), pins.reload(), tournaments.reload()]);
    setRefreshing(false);
  }, [leagues, pins, tournaments]);

  function choose(next: Tab) {
    setTab(next);
    setOpened((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    router.setParams({ tab: next });
  }

  const loadError =
    leagues.status === 'error'
      ? leagues.message
      : pins.status === 'error'
        ? pins.message
        : tournaments.status === 'error'
          ? tournaments.message
          : null;

  return (
    <View testID="leagues-screen" style={styles.screen}>
      <NightHeader title="Leagues" tabs={{ options: TABS, value: tab, onChange: choose }} />
      {opened.has('matches') ? (
        <View testID="leagues-panel-matches" style={tab === 'matches' ? styles.flex : styles.hidden}>
          <MatchesTab
            today={today}
            myTeamIds={myTeamIds}
            pinnedKeys={pinnedKeys}
            names={names}
            cities={cities}
            onTogglePin={(group) => void pins.toggle(group.scope, group.format)}
          />
        </View>
      ) : null}
      {opened.has('leagues') ? (
        <View testID="leagues-panel-leagues" style={tab === 'leagues' ? styles.flex : styles.hidden}>
          <LeaguesTab
            directory={directory}
            error={loadError}
            pinError={pins.toggleError}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            onRetry={retry}
            onTogglePin={(entry) => void pins.toggle(entry.scope, entry.format)}
            onToggleTournamentPin={(entry) => void pins.toggleTournament(entry.tournament.id)}
          />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  hidden: { display: 'none' },
}));
