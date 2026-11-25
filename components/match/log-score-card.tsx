// Home's "Log the score" (spec 15 section 0.6, image 01): one card per game
// that still needs the viewer's score as its captain, or whose captains'
// scores differ. Log opens the logging screens.
import { router } from 'expo-router';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { formatMatchWhen } from '@/lib/match/format';
import type { MatchToLog } from '@/lib/match/log-score-api';
import { makeStyles } from '@/lib/theme';

export function LogScoreCard({ match }: { match: MatchToLog }) {
  const styles = useStyles();
  const title = match.state === 'mismatch' ? 'Scores differ' : 'Log the score';
  const line = `${match.labelA} v ${match.labelB} · ${formatMatchWhen(match.kickoffAt)}`;
  return (
    <Card testID={`log-score-card-${match.matchId}`}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text variant="headline">{title}</Text>
          <Text variant="callout" tone="inkMuted" numberOfLines={1}>
            {line}
          </Text>
        </View>
        <Button
          label="Log"
          size="compact"
          onPress={() => router.push({ pathname: '/match/after-game', params: { id: match.matchId } })}
          accessibilityHint={line}
          testID={`home-log-score-${match.matchId}`}
        />
      </View>
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  text: { flex: 1, gap: space.xs },
}));
