// The match screen: one match's result, entered and answered with A2's
// functions (docs/specs/match-record.md section 5.2). Opened from Home, the
// notifications list and a tapped push (lib/push-tap.tsx).
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MatchResultPanel } from '@/components/match/result-panel';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';
import { formatMatchWhen } from '@/lib/match/format';
import { useResultMatch } from '@/lib/match/use-match-result';
import { useMyCaptainTeamIds } from '@/lib/use-fixtures';

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = Array.isArray(id) ? id[0] : id;
  const result = useResultMatch(matchId);
  const captainTeamIds = useMyCaptainTeamIds();
  const { reload } = result;

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  let content: React.ReactNode;
  if (result.status === 'loading') {
    content = (
      <View testID="match-skeleton" style={styles.stack}>
        <SkeletonBlock width="100%" height={120} />
        <SkeletonText lines={2} />
      </View>
    );
  } else if (result.status === 'error') {
    content = (
      <Banner tone="danger" message="Could not load this match." action={{ label: 'Try again', onPress: reload }} />
    );
  } else if (!result.match) {
    content = (
      <Card>
        <EmptyState icon="sportscourt.fill" message="Match not found" />
      </Card>
    );
  } else {
    const { match } = result;
    content = (
      <View style={styles.stack}>
        <Text variant="callout" tone="inkMuted" tabular>
          {[formatMatchWhen(match.match.kickoff_at), match.venueName].filter(Boolean).join(' · ')}
        </Text>
        <Card>
          <MatchResultPanel
            match={match}
            viewerId={result.viewerId}
            captainTeamIds={captainTeamIds}
            onChanged={reload}
          />
        </Card>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Match' }} />
      <ScrollView contentContainerStyle={styles.content}>{content}</ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg },
  stack: { gap: space.md },
});
