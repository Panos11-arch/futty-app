import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { PowerRankingList } from '@/components/match/power-ranking-list';
import { RankingsHeader, type RankingsView } from '@/components/match/rankings-header';
import { HowItsPickedSheet, HowItWorksSheet } from '@/components/match/rankings-sheets';
import { TeamOfTheWeekView } from '@/components/match/team-of-the-week-view';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import { isTeamFormat, TEAM_FORMATS, type TeamFormat } from '@/lib/match/stats-api';
import { useMyMostPlayedFormat, useTeamOfTheWeekById } from '@/lib/match/use-stats';
import { makeStyles } from '@/lib/theme';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/**
 * The Rankings tab (S15; images 14, 15 and 27): Team of the Week | Power
 * ranking, for one format at a time. It opens on the viewer's most played
 * format (5-a-side with none). Params: view ('totw' | 'power'), format, and
 * teamId (a team of the week a notification or the Home card names; it sets
 * the format and week). The header stays fixed; each view scrolls itself.
 */
export default function RankingsScreen() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ view?: string; format?: string; teamId?: string }>();
  const viewParam = one(params.view);
  const formatParam = one(params.format);
  const teamId = one(params.teamId);

  const [view, setView] = useState<RankingsView>(viewParam === 'power' ? 'power' : 'totw');
  const [picked, setPicked] = useState<TeamFormat | null>(isTeamFormat(formatParam) ? formatParam : null);
  const [how, setHow] = useState(false);

  useEffect(() => {
    if (viewParam === 'power' || viewParam === 'totw') setView(viewParam);
  }, [viewParam]);
  useEffect(() => {
    if (isTeamFormat(formatParam)) setPicked(formatParam);
  }, [formatParam]);

  const linked = useTeamOfTheWeekById(teamId);
  const linkedTeam = teamId && linked.status === 'ready' ? linked.team : null;
  useEffect(() => {
    if (linkedTeam && isTeamFormat(linkedTeam.format)) {
      setPicked(linkedTeam.format);
      setView('totw');
    }
  }, [linkedTeam]);

  const most = useMyMostPlayedFormat();
  const mostPlayed = most.status === 'ready' && isTeamFormat(most.format) ? most.format : null;
  const format: TeamFormat = picked ?? mostPlayed ?? TEAM_FORMATS[0];
  const waiting = (!picked && most.status === 'loading') || (!!teamId && linked.status === 'loading');

  return (
    <View testID="rankings-screen" style={styles.screen}>
      <RankingsHeader
        view={view}
        onChangeView={setView}
        format={format}
        onChangeFormat={setPicked}
        onPressHow={() => setHow(true)}
      />
      {waiting ? (
        <View testID="rankings-skeleton" style={styles.skeleton}>
          <SkeletonBlock width="100%" height={420} />
        </View>
      ) : view === 'totw' ? (
        <TeamOfTheWeekView
          key={`${format}|${linkedTeam?.id ?? ''}`}
          format={format}
          initialTeam={linkedTeam?.format === format ? linkedTeam : null}
          onSeePowerRanking={() => setView('power')}
        />
      ) : (
        <PowerRankingList key={format} format={format} onSeeTeamOfTheWeek={() => setView('totw')} />
      )}
      <HowItsPickedSheet visible={how && view === 'totw'} onClose={() => setHow(false)} />
      <HowItWorksSheet visible={how && view === 'power'} onClose={() => setHow(false)} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  skeleton: { padding: space.lg },
}));
