import { router } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconLabel } from '@/components/icon-label';
import { MenuRow, MenuSection } from '@/components/menu-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useRecentResults } from '@/lib/use-recent-results';

function formatResultDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ActivityScreen() {
  const recentResults = useRecentResults();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <MenuSection title="Recent results">
          {recentResults.status === 'loading' ? <ActivityIndicator style={styles.padded} /> : null}
          {recentResults.status === 'error' ? (
            <ThemedText style={styles.note}>Could not load: {recentResults.message}</ThemedText>
          ) : null}
          {recentResults.status === 'ready' && recentResults.results.length === 0 ? (
            <IconLabel icon="magnifyingglass" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
              No results yet.
            </IconLabel>
          ) : null}
        </MenuSection>

        {recentResults.status === 'ready'
          ? recentResults.results.map((result) => (
              <ThemedView key={result.key} style={[styles.resultCard, { borderColor: border }]}>
                <ThemedText type="defaultSemiBold" style={styles.resultTeams}>
                  {result.kind === 'booking'
                    ? `You ${result.homeScore}–${result.awayScore}`
                    : `${result.homeTeamName} ${result.homeScore}–${result.awayScore} ${result.awayTeamName}`}
                </ThemedText>
                <ThemedText style={styles.resultMeta}>
                  {result.kind === 'league' ? 'League' : result.kind === 'friendly' ? 'Friendly' : 'Pickup game'} ·{' '}
                  {formatResultDate(result.playedAt)}
                </ThemedText>
              </ThemedView>
            ))
          : null}

        <MenuSection>
          <MenuRow icon="calendar" label="Matches" onPress={() => router.push('/account/activity/matches')} />
          <MenuRow icon="shield.fill" label="Teams" onPress={() => router.push('/account/activity/teams')} />
        </MenuSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 16,
    padding: 16,
  },
  padded: {
    padding: 12,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
    padding: 12,
  },
  resultCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  resultTeams: {
    fontFamily: FuttyFonts.sansMedium,
    fontSize: 14,
  },
  resultMeta: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
});
