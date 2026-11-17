import { Fragment } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, hairline, space } from '@/constants/futty-theme';
import { useRecentResults } from '@/lib/use-recent-results';

// Everything Home/Activity's cards cap at 5 — this is the "full history"
// page they link out to, so it asks for a much higher ceiling instead.
const FULL_HISTORY_LIMIT = 200;

function formatResultDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export default function MatchesScreen() {
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
  row: { gap: 2, paddingHorizontal: space.lg, paddingVertical: space.md },
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
});
