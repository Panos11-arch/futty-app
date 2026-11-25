// Step 4, Review (image 09): text only, no lineup picture. The score, each
// scorer with their goals, each assister with their assists. A side the
// caller doesn't log shows its score only.
import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ICON } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { LOCKED_LINE, reviewSides, sideLabel, winner, type Draft, type MatchLog, type ReviewSide } from '@/lib/match/log-score';
import type { Side } from '@/lib/match/types';
import { makeStyles, useTheme } from '@/lib/theme';

export function ReviewStep({ log, draft }: { log: MatchLog; draft: Draft }) {
  const styles = useStyles();
  const sides = reviewSides(log, draft);
  const won = winner(draft.score);
  const anyAssists = sides.some((s) => s.assistsTotal > 0);
  return (
    <View style={styles.wrap} testID="post-match-step-review">
      <Text variant="display" accessibilityRole="header">
        Review
      </Text>
      <Card testID="log-score-review-score">
        <View style={styles.section}>
          <Text variant="caption" tone="inkMuted" style={styles.caps}>
            Final score
          </Text>
          <View style={styles.scoreRow}>
            <SideName log={log} side="a" won={won === 'a'} />
            <Text variant="display" tabular>{`${draft.score.a} : ${draft.score.b}`}</Text>
            <SideName log={log} side="b" won={won === 'b'} alignEnd />
          </View>
        </View>
      </Card>
      <Card testID="log-score-review-goals">
        <View style={styles.section}>
          <Text variant="caption" tone="inkMuted" style={styles.caps}>
            Goals
          </Text>
          {sides.map((s, i) => (
            <SideBlock key={s.side} side={s} first={i === 0} kind="goals" score={draft.score[s.side]} />
          ))}
        </View>
      </Card>
      {anyAssists ? (
        <Card testID="log-score-review-assists">
          <View style={styles.section}>
            <Text variant="caption" tone="inkMuted" style={styles.caps}>
              Assists
            </Text>
            {sides
              .filter((s) => s.logged)
              .map((s, i) => (
                <SideBlock key={s.side} side={s} first={i === 0} kind="assists" score={draft.score[s.side]} />
              ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

function SideName({ log, side, won, alignEnd = false }: { log: MatchLog; side: Side; won: boolean; alignEnd?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.sideName, alignEnd && styles.end]}>
      <View style={[styles.dot, side === 'a' ? styles.dotA : styles.dotB]} />
      <Text variant="headline" numberOfLines={2} style={styles.shrink}>
        {sideLabel(log, side)}
      </Text>
      {won ? (
        <Text variant="caption" tone="greenInk" style={styles.win} testID={`log-score-win-${side}`}>
          WIN
        </Text>
      ) : null}
    </View>
  );
}

function SideBlock({ side, first, kind, score }: { side: ReviewSide; first: boolean; kind: 'goals' | 'assists'; score: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const lines = kind === 'goals' ? side.goals : side.assists;
  const total = kind === 'goals' ? side.goalsTotal : side.assistsTotal;
  let right: string;
  if (!side.logged) right = `${score} ${score === 1 ? 'goal' : 'goals'}`;
  else if (kind === 'goals') right = `${total} of ${score}`;
  else right = `${total} of ${score} ${score === 1 ? 'goal' : 'goals'} assisted`;
  const complete = side.logged && kind === 'goals' && total === score;
  return (
    <View style={[styles.block, !first && styles.divided]} testID={`log-score-review-${kind}-${side.side}`}>
      <View style={styles.blockHead}>
        <View style={styles.sideName}>
          <View style={[styles.dot, side.side === 'a' ? styles.dotA : styles.dotB]} />
          <Text variant="headline">{side.label}</Text>
        </View>
        <View style={styles.sideName}>
          <Text variant="callout" tone={complete ? 'positive' : 'inkMuted'} tabular>
            {right}
          </Text>
          {complete ? <IconSymbol name="checkmark" size={ICON.small} color={colors.positive} /> : null}
        </View>
      </View>
      {side.logged ? null : (
        <Text variant="callout" tone="inkMuted">
          {LOCKED_LINE}
        </Text>
      )}
      {lines.map((l) => (
        <View key={l.name} style={styles.line}>
          <Text variant="body">{l.name}</Text>
          <Text variant="headline" tabular>
            {String(l.count)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  wrap: { gap: space.lg, paddingHorizontal: space.lg, paddingTop: space.lg },
  section: { gap: space.md },
  caps: { textTransform: 'uppercase', letterSpacing: 1 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  sideName: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  end: { justifyContent: 'flex-end' },
  shrink: { flexShrink: 1 },
  dot: { width: space.md, height: space.md, borderRadius: radius.pill },
  dotA: { backgroundColor: colors.green },
  dotB: { borderWidth: 2, borderColor: colors.muted },
  win: {
    backgroundColor: colors.green,
    borderRadius: radius.chip,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  block: { gap: space.sm },
  divided: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md },
  blockHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
}));
