// A team's power ranking position in each format where it is listed (S15;
// match-record.md decision 1m), on the team page: "5-a-side · #3 · 1012".
// Hidden when the team is listed nowhere. A row opens Rankings → Power
// ranking in that format.
import { router } from 'expo-router';
import { View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { formatPoints } from '@/lib/match/power-ranking-api';
import { useTeamPowerRanking } from '@/lib/match/use-stats';
import { makeStyles } from '@/lib/theme';

export function TeamPowerRanking({ teamId }: { teamId: string }) {
  const styles = useStyles();
  const ranking = useTeamPowerRanking(teamId);
  if (ranking.status === 'ready' && ranking.rows.length === 0) return null;
  return (
    <View style={styles.section} testID="team-power-ranking">
      <SectionHeader title="Power ranking" />
      {ranking.status === 'loading' ? <SkeletonText lines={2} /> : null}
      {ranking.status === 'error' ? (
        <Banner tone="danger" message="Couldn’t load the ranking." action={{ label: 'Try again', onPress: ranking.reload }} />
      ) : null}
      {ranking.status === 'ready' ? (
        <Card padded={false}>
          {ranking.rows.map((r) => (
            <ListRow
              key={r.format}
              testID={`team-power-ranking-${r.format.split('-')[0]}`}
              title={r.format}
              accessibilityLabel={`${r.format}: number ${r.rank}, ${formatPoints(r.points)} points`}
              onPress={() => router.push({ pathname: '/rankings', params: { view: 'power', format: r.format } })}
              chevron
              trailing={
                <Text variant="headline" tabular>
                  {`#${r.rank} · ${formatPoints(r.points)}`}
                </Text>
              }
            />
          ))}
        </Card>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  section: { gap: space.sm },
}));
