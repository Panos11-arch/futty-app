// Step 1, Score (image 07): both sides' scores, entered by the captain, with
// the two sides' names (Bibs and Non-bibs, or the team names).
import { View } from 'react-native';

import { StepButton } from '@/components/match/log-score/step-button';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { formatMatchDate } from '@/lib/match/format';
import { SIDES, setScore, sideLabel, type Draft, type MatchLog } from '@/lib/match/log-score';
import { makeStyles } from '@/lib/theme';

/** Each side's + (Bibs' keeps the scorers editor's old add-goal id). */
const PLUS_IDS = { a: { testID: 'add-goal' }, b: { testID: 'log-score-b-plus' } } as const;

export function ScoreStep({ log, draft, onChange }: { log: MatchLog; draft: Draft; onChange: (d: Draft) => void }) {
  const styles = useStyles();
  const subtitle = [formatMatchDate(log.kickoffAt), log.venueName, log.pitchName].filter(Boolean).join(' · ');
  return (
    <View style={styles.wrap} testID="post-match-step-score">
      <View style={styles.head}>
        <Text variant="display" accessibilityRole="header" style={styles.centre}>
          Score
        </Text>
        {subtitle ? (
          <Text variant="callout" tone="inkMuted" style={styles.centre}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.row}>
        {SIDES.map((side, i) => (
          <View key={side} style={styles.rowPart}>
            {i === 1 ? (
              <Text variant="title" tone="inkMuted" accessible={false}>
                :
              </Text>
            ) : null}
            <View style={styles.side}>
              <View style={styles.stepper}>
                <StepButton
                  kind="minus"
                  accessibilityLabel={`${sideLabel(log, side)} one goal fewer`}
                  disabled={draft.score[side] === 0}
                  onPress={() => onChange(setScore(draft, side, draft.score[side] - 1))}
                  testID={`log-score-${side}-minus`}
                />
                <Text
                  variant="display"
                  tabular
                  style={styles.number}
                  testID={`log-score-${side}-value`}
                  accessibilityLabel={`${sideLabel(log, side)} ${draft.score[side]}`}>
                  {String(draft.score[side])}
                </Text>
                <StepButton
                  kind="plus"
                  accessibilityLabel={`${sideLabel(log, side)} one goal more`}
                  onPress={() => onChange(setScore(draft, side, draft.score[side] + 1))}
                  {...PLUS_IDS[side]}
                />
              </View>
              <Text variant="headline" numberOfLines={2} style={styles.centre}>
                {sideLabel(log, side)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.xxl, paddingVertical: space.xl },
  head: { gap: space.sm },
  centre: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
  rowPart: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  side: { flex: 1, alignItems: 'center', gap: space.lg },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  number: { minWidth: space.xxl + space.md, textAlign: 'center' },
}));
