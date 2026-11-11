// One line for a match: side a, the score (or the kickoff time, or why
// there is no score), side b. Scores and times use tabular figures; times
// are Cyprus time. Never says "void" (17, rules for every prompt).
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { formatKickoff } from '@/lib/match/format';
import type { MatchListItem, Side } from '@/lib/match/types';

export type ScoreLineContent = {
  /** The middle: a score, "Forfeit", a dash or the kickoff time. */
  centre: string;
  /** Why there is no score, or who forfeited. */
  caption: string | null;
  /** The side shown in bold: the winner. */
  winner: Side | null;
  /** The whole line as a screen reader says it. */
  spoken: string;
};

const DASH = '–';

export function scoreLineContent(item: MatchListItem): ScoreLineContent {
  const { a, b } = item.sides;
  const teams = `${a.label} v ${b.label}`;
  const time = formatKickoff(item.match.kickoff_at);
  const r = item.result;
  const withCaption = (caption: string): ScoreLineContent => ({
    centre: DASH,
    caption,
    winner: null,
    spoken: `${teams}. ${caption}`,
  });

  switch (item.match.status) {
    case 'scheduled':
      return { centre: time, caption: null, winner: null, spoken: `${teams}, kicks off at ${time}` };
    case 'void':
      return { centre: time, caption: 'Cancelled', winner: null, spoken: `${teams}, ${time}. Cancelled` };
    case 'played':
      return withCaption('Waiting for the result');
    case 'disputed':
      return withCaption("Disputed · won't count");
    case 'no_result':
      return withCaption('No result entered');
    case 'confirmed':
      break;
  }

  if (r?.forfeit_side) {
    const team = r.forfeit_side === 'a' ? a.label : b.label;
    const caption = r.forfeit_reason === 'no_show' ? `${team} didn't show` : `${team} pulled out`;
    return {
      centre: 'Forfeit',
      caption,
      winner: r.forfeit_side === 'a' ? 'b' : 'a',
      spoken: `${teams}, forfeit. ${caption}`,
    };
  }
  if (r && r.side_a_score !== null && r.side_b_score !== null) {
    return {
      centre: `${r.side_a_score} ${DASH} ${r.side_b_score}`,
      caption: null,
      winner: r.outcome === 'side_a_won' ? 'a' : r.outcome === 'side_b_won' ? 'b' : null,
      spoken: `${a.label} ${r.side_a_score}, ${b.label} ${r.side_b_score}`,
    };
  }
  return withCaption('Waiting for the result');
}

export function ScoreLine({ item }: { item: MatchListItem }) {
  const content = scoreLineContent(item);
  const label = (side: Side) => (
    <Text
      variant={content.winner === side ? 'headline' : 'body'}
      style={[styles.team, side === 'a' ? styles.teamA : styles.teamB]}>
      {item.sides[side].label}
    </Text>
  );

  return (
    <View testID="score-line" accessible accessibilityLabel={content.spoken} style={styles.wrap}>
      <View style={styles.row}>
        {label('a')}
        <Text variant="headline" tabular style={styles.centre}>
          {content.centre}
        </Text>
        {label('b')}
      </View>
      {content.caption ? (
        <Text variant="caption" tone="inkMuted" style={styles.caption}>
          {content.caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  team: { flex: 1 },
  teamA: { textAlign: 'right' },
  teamB: { textAlign: 'left' },
  centre: { textAlign: 'center' },
  caption: { textAlign: 'center' },
});
