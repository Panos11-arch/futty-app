// A match in a list (recent matches, upcoming fixtures): the score line,
// when and where in Cyprus time, and the viewer's result when it counts for
// them (decisions 1b.2 and 1b.3: viewerSide is null otherwise).
import { StyleSheet, View } from 'react-native';

import { FormChip, spokenForm } from '@/components/match/form-chips';
import { ScoreLine, scoreLineContent } from '@/components/match/score-line';
import { Card } from '@/components/ui/card';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';
import { formResult } from '@/lib/match/form';
import { formatMatchWhen } from '@/lib/match/format';
import type { MatchListItem } from '@/lib/match/types';

export type MatchRowProps =
  | { item: MatchListItem; onPress?: () => void; loading?: false }
  | { loading: true; item?: undefined; onPress?: undefined };

export function MatchRow(props: MatchRowProps) {
  if (props.loading) {
    return (
      <Card style={styles.card}>
        <View testID="match-row-skeleton">
          <SkeletonText lines={2} />
        </View>
      </Card>
    );
  }

  const { item, onPress } = props;
  const when = formatMatchWhen(item.match.kickoff_at);
  const result = item.result && item.viewerSide ? formResult(item.result, item.viewerSide) : null;
  const spoken = [
    scoreLineContent(item).spoken,
    `${when}, ${item.venueName}`,
    result ? `You ${spokenForm(result)}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Card onPress={onPress} accessibilityLabel={onPress ? spoken : undefined} style={styles.card}>
      <View style={styles.row}>
        <View style={styles.body}>
          <ScoreLine item={item} />
          <Text testID="match-row-meta" variant="caption" tone="inkMuted" tabular>
            {`${when} · ${item.venueName}`}
          </Text>
        </View>
        {result ? (
          <View testID="match-row-result">
            <FormChip result={result} />
          </View>
        ) : null}
        {onPress ? <IconSymbol name="chevron.right" size={ICON.small} color={colors.inkMuted} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: MIN_TOUCH },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  body: { flex: 1, gap: space.sm },
});
