import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
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
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {results.status === 'loading' ? <ActivityIndicator /> : null}
        {results.status === 'error' ? <ThemedText style={styles.note}>Could not load: {results.message}</ThemedText> : null}
        {results.status === 'ready' && results.results.length === 0 ? (
          <IconLabel icon="magnifyingglass" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
            No matches logged yet.
          </IconLabel>
        ) : null}
        {results.status === 'ready'
          ? results.results.map((result) => (
              <ThemedView key={result.key} style={[styles.card, { borderColor: border }]}>
                <ThemedText type="defaultSemiBold" style={styles.teams}>
                  {result.kind === 'booking'
                    ? `You ${result.homeScore}–${result.awayScore}`
                    : `${result.homeTeamName} ${result.homeScore}–${result.awayScore} ${result.awayTeamName}`}
                </ThemedText>
                <ThemedText style={styles.meta}>
                  {result.kind === 'league' ? 'League' : result.kind === 'friendly' ? 'Friendly' : 'Pickup game'} ·{' '}
                  {formatResultDate(result.playedAt)}
                </ThemedText>
              </ThemedView>
            ))
          : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 10,
    padding: 16,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  teams: {
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 14,
  },
  meta: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
});
