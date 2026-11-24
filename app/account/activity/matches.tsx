import { Fragment } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import { formatMatchDate } from '@/lib/match/format';
import { useRecentResults } from '@/lib/use-recent-results';

// Everything Home/Activity's cards cap at 5 — this is the "full history"
// page they link out to, so it asks for a much higher ceiling instead.
const FULL_HISTORY_LIMIT = 200;

/** "Fri 20 Nov 2026", the Cyprus date. */
function formatResultDate(iso: string) {
  if (!iso) return '';
  const year = new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', timeZone: CYPRUS_TIME_ZONE });
  return `${formatMatchDate(iso)} ${year}`;
}

export default function MatchesScreen() {
  const styles = useStyles();
  const results = useRecentResults(FULL_HISTORY_LIMIT);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {results.status === 'loading' ? (
          <Card testID="matches-skeleton">
            <SkeletonText lines={4} />
          </Card>
        ) : null}
        {results.status === 'error' ? (
          <Banner
            tone="danger"
            message={`Could not load: ${results.message}`}
            action={{ label: 'Try again', onPress: results.reload }}
          />
        ) : null}
        {results.status === 'ready' && results.results.length === 0 ? (
          <EmptyState icon="sportscourt.fill" message="No matches logged yet." />
        ) : null}
        {results.status === 'ready' && results.results.length > 0 ? (
          <Card padded={false}>
            {results.results.map((result, i) => (
              <Fragment key={result.key}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.row}>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
  row: { gap: 2, paddingHorizontal: space.lg, paddingVertical: space.md },
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
}));
