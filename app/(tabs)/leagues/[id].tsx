// S10: a league's competition page (image 13; SofaScore 07-20), built on the
// server's reads (match-record.md 1n). A fixed night header and one
// scrolling child per tab, never nested. The URL stays /leagues/[id] so every
// old link keeps working; ?season= picks an earlier season and ?tab= a tab.
// Leagues only: the Knockout tab, By group and group tables come with S10A.
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  COMPETITION_TABS,
  CompetitionHeader,
  type CompetitionTab,
} from '@/components/competition/competition-header';
import type { SeasonTeam } from '@/components/competition/matches-tab';
import { MatchesTab } from '@/components/competition/matches-tab';
import { OptionSheet } from '@/components/competition/option-sheet';
import { OverviewSkeleton, OverviewTab } from '@/components/competition/overview-tab';
import { PlayerStatsTab } from '@/components/competition/player-stats-tab';
import { PowerTab } from '@/components/competition/power-tab';
import { StandingsTab } from '@/components/competition/standings-tab';
import { StatsTab } from '@/components/competition/stats-tab';
import { NightHeader } from '@/components/match/night-header';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import type { Competition } from '@/lib/match/competition-api';
import { competitionBadge, ISLAND_WIDE, normaliseScope, scopeLabel } from '@/lib/match/league-directory';
import { useCompetitionPins } from '@/lib/match/use-competition-pins';
import { useCompetition, useCompetitionStandings } from '@/lib/match/use-competition';
import { makeStyles } from '@/lib/theme';
import { useLeagues } from '@/lib/use-leagues';
import { useMyTeams } from '@/lib/use-my-teams';

function backToLeagues() {
  if (router.canGoBack()) router.back();
  else router.replace('/leagues');
}

const isTab = (t: unknown): t is CompetitionTab => COMPETITION_TABS.some((x) => x.value === t);

/** "Limassol · 5-a-side", "Cyprus · 5-a-side" for the island-wide league. */
export function competitionSubtitle(c: Pick<Competition, 'area' | 'format'>): string {
  const area = normaliseScope(c.area) === ISLAND_WIDE ? 'Cyprus' : scopeLabel(c.area);
  return `${area} · ${c.format}`;
}

function Body({
  competition,
  reload,
  initialTab,
}: {
  competition: Competition;
  reload: () => Promise<void>;
  initialTab: CompetitionTab;
}) {
  const styles = useStyles();
  const [tab, setTab] = useState<CompetitionTab>(initialTab);
  const [visited, setVisited] = useState<Set<CompetitionTab>>(new Set([initialTab]));
  const [pickingSeason, setPickingSeason] = useState(false);
  const pins = useCompetitionPins();
  const leagues = useLeagues();
  const myTeams = useMyTeams();
  const seasonId = competition.season.id;
  const standings = useCompetitionStandings(seasonId);

  const myTeamIds = useMemo(
    () => new Set(myTeams.status === 'ready' ? myTeams.teams.map(({ team }) => team.id) : []),
    [myTeams],
  );
  const allLeagues = leagues.status === 'ready' ? leagues.leagues : [];
  const hub = allLeagues.find((l) => l.id === competition.id) ?? null;
  const teams: SeasonTeam[] = useMemo(() => {
    if (standings.status !== 'ready') return [];
    const byId = new Map<string, string>();
    for (const t of standings.standings.tables) for (const r of t.rows) byId.set(r.teamId, r.teamName);
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [standings]);
  const tableIds = competition.season.tables.length > 0 ? competition.season.tables.map((t) => t.id) : [seasonId];

  const go = (next: CompetitionTab) => {
    setTab(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
  };

  const pinned = pins.status === 'ready' ? pins.isPinned(competition.area, competition.format) : competition.isPinned;
  const seasons = competition.seasons;

  const refreshAll = async () => {
    await Promise.all([reload(), leagues.reload(), standings.reload()]);
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
        name={competition.name}
        subtitle={competitionSubtitle(competition)}
        badge={competitionBadge(competition.area, competition.format)}
        onBack={backToLeagues}
        pin={{ pinned, onToggle: () => void pins.toggle(competition.area, competition.format) }}
        season={seasons.length > 1 ? { label: competition.season.name, onPress: () => setPickingSeason(true) } : null}
        tab={tab}
        onTab={go}
      />
      {pins.toggleError ? (
        <Text variant="callout" tone="danger" style={styles.pinError} accessibilityLiveRegion="polite">
          {pins.toggleError}
        </Text>
      ) : null}
      {panel(
        'overview',
        <OverviewTab
          competition={competition}
          hub={hub}
          leagues={allLeagues}
          onChanged={() => void refreshAll()}
          onRefresh={refreshAll}
          onGoTab={go}
        />,
      )}
      {panel('matches', <MatchesTab seasonId={seasonId} tableIds={tableIds} teams={teams} />)}
      {panel(
        'standings',
        <StandingsTab
          standings={standings}
          myTeamIds={myTeamIds}
          waitingPoolHubId={hub && hub.stage === 'divisions' ? hub.id : null}
          onSeeMatches={() => go('matches')}
        />,
      )}
      {panel('player-stats', <PlayerStatsTab seasonId={seasonId} teams={teams} />)}
      {panel('stats', <StatsTab seasonId={seasonId} onSeeMatches={() => go('matches')} />)}
      {panel('power', <PowerTab seasonId={seasonId} format={competition.format} onSeeStandings={() => go('standings')} />)}
      <OptionSheet
        visible={pickingSeason}
        onClose={() => setPickingSeason(false)}
        title="Season"
        options={seasons.map((s) => ({ key: s.id, label: s.name }))}
        selectedKey={seasonId}
        onSelect={(key) => router.setParams({ season: key })}
        testID="competition-seasons"
      />
    </>
  );
}

export default function CompetitionPage() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ id: string; season?: string; tab?: string }>();
  const competition = useCompetition(params.id, params.season ?? null);
  const initialTab = isTab(params.tab) ? params.tab : 'overview';

  const notFound =
    (competition.status === 'error' && competition.message === 'competition_not_found') ||
    (competition.status === 'ready' && !competition.competition);

  return (
    <View testID="league-page" style={styles.screen}>
      {competition.status === 'ready' && competition.competition ? (
        <Body
          key={competition.competition.season.id}
          competition={competition.competition}
          reload={competition.reload}
          initialTab={initialTab}
        />
      ) : (
        <>
          <NightHeader title="League" back={{ label: 'Leagues', onPress: backToLeagues, testID: 'league-page-back' }} />
          {competition.status === 'loading' ? <OverviewSkeleton /> : null}
          {notFound ? (
            <EmptyState icon="trophy.fill" message="League not found" action={{ label: 'Back to leagues', onPress: backToLeagues }} />
          ) : null}
          {competition.status === 'error' && !notFound ? (
            <View style={styles.content}>
              <Banner
                tone="danger"
                message="Couldn’t load this league."
                action={{ label: 'Try again', onPress: competition.reload }}
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
