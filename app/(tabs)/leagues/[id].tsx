import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { OpenLeagueSection, StandardLeagueSection } from '@/components/match/league-sections';
import { NightHeader } from '@/components/match/night-header';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonText } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import { buildLeagueDirectory, competitionBadge, competitionKey, ISLAND_WIDE, normaliseScope } from '@/lib/match/league-directory';
import { makeStyles } from '@/lib/theme';
import { useLeagues } from '@/lib/use-leagues';
import { useMyTeams } from '@/lib/use-my-teams';

function backToLeagues() {
  if (router.canGoBack()) router.back();
  else router.replace('/leagues');
}

/**
 * A league in sign-up or running, until S10 builds its competition page: the
 * existing standings (or divisions and waiting pool) and the join flow, as
 * on the old Play → Leagues screen.
 */
export default function LeaguePage() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const leagues = useLeagues();
  const myTeams = useMyTeams();
  const myTeamIds = useMemo(
    () => new Set(myTeams.status === 'ready' ? myTeams.teams.map(({ team }) => team.id) : []),
    [myTeams],
  );

  const league = leagues.status === 'ready' ? leagues.leagues.find((l) => l.id === id) ?? null : null;
  const entry = useMemo(() => {
    if (!league || leagues.status !== 'ready') return null;
    const dir = buildLeagueDirectory(leagues.leagues, []);
    const key = competitionKey(league.scope, league.format);
    return [dir.open, ...dir.cities].flatMap((g) => g.entries).find((e) => e.key === key) ?? null;
  }, [league, leagues]);

  const title = entry?.name ?? league?.name ?? 'League';
  const subtitle = entry ? `${entry.area} · ${entry.format} league · ${entry.stageLabel}` : undefined;

  return (
    <View testID="league-page" style={styles.screen}>
      <NightHeader
        title={title}
        subtitle={subtitle}
        badge={league ? competitionBadge(league.scope, league.format) : undefined}
        back={{ label: 'Leagues', onPress: backToLeagues, testID: 'league-page-back' }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {leagues.status === 'loading' ? (
          <Card testID="league-page-skeleton">
            <SkeletonText lines={5} />
          </Card>
        ) : null}
        {leagues.status === 'error' ? (
          <Banner tone="danger" message="Could not load this league." action={{ label: 'Try again', onPress: leagues.reload }} />
        ) : null}
        {leagues.status === 'ready' && !league ? (
          <EmptyState icon="trophy.fill" message="League not found" action={{ label: 'Back to leagues', onPress: backToLeagues }} />
        ) : null}
        {league && leagues.status === 'ready' ? (
          normaliseScope(league.scope) === ISLAND_WIDE ? (
            <StandardLeagueSection league={league} myTeamIds={myTeamIds} />
          ) : (
            <OpenLeagueSection hub={league} leagues={leagues.leagues} reloadLeagues={leagues.reload} myTeamIds={myTeamIds} />
          )
        ) : null}
        {league ? (
          <Button label="Your fixtures" variant="plain" onPress={() => router.push('/upcoming-fixtures')} testID="league-page-fixtures" />
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
}));
