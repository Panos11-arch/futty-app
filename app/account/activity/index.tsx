import { router } from 'expo-router';
import { Fragment } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuRow, MenuSection } from '@/components/menu-row';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { formatMatchDate } from '@/lib/match/format';
import { useRecentResults } from '@/lib/use-recent-results';

/** "Fri 20 Nov", the Cyprus date. */
function formatResultDate(iso: string) {
  if (!iso) return '';
  return formatMatchDate(iso);
}

export default function ActivityScreen() {
  const styles = useStyles();
  const recentResults = useRecentResults();

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <SectionHeader title="Recent results" />
          {recentResults.status === 'loading' ? (
            <Card testID="results-skeleton">
              <SkeletonText lines={3} />
            </Card>
          ) : null}
          {recentResults.status === 'error' ? (
            <Banner
              tone="danger"
              message={`Could not load: ${recentResults.message}`}
              action={{ label: 'Try again', onPress: recentResults.reload }}
            />
          ) : null}
          {recentResults.status === 'ready' && recentResults.results.length === 0 ? (
            <EmptyState icon="sportscourt.fill" message="No results yet." />
          ) : null}
          {recentResults.status === 'ready' && recentResults.results.length > 0 ? (
            <Card padded={false}>
              {recentResults.results.map((result, i) => (
                <Fragment key={result.key}>
                  {i > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.resultRow}>
                    <Text variant="body" tabular>
                      {result.kind === 'booking'
                        ? `You ${result.homeScore}–${result.awayScore}`
                        : `${result.homeTeamName} ${result.homeScore}–${result.awayScore} ${result.awayTeamName}`}
                    </Text>
                    <Text variant="callout" tone="inkMuted">
                      {result.kind === 'league' ? 'League' : result.kind === 'friendly' ? 'Friendly' : 'Pickup game'} ·{' '}
                      {formatResultDate(result.playedAt)}
                    </Text>
                  </View>
                </Fragment>
              ))}
            </Card>
          ) : null}
        </View>

        <MenuSection>
          <MenuRow icon="calendar" label="Matches" onPress={() => router.push('/account/activity/matches')} />
          <MenuRow icon="shield.fill" label="Teams" onPress={() => router.push('/account/activity/teams')} />
        </MenuSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  section: { gap: space.sm },
  resultRow: { gap: 2, paddingHorizontal: space.lg, paddingVertical: space.md },
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
}));
